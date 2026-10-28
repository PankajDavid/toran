import { z } from "zod";
import { LIMITS } from "./config.js";
import type { BudgetResult, PlanWarning } from "./budget.js";
import type { TimelineTask } from "./timeline.js";

/**
 * "Deal closed": when the user books a vendor, they record the agreed price and
 * the advance paid. This module re-balances the budget from those real numbers.
 *
 * Rule: savings on a booking go into the contingency buffer; overspending is
 * taken from the contingency buffer first; anything beyond that is shown as
 * "over budget". Plain code, so every rupee is accounted for.
 */

const amounts = {
  agreedINR: z.number().int("Amounts must be whole rupees").min(0).max(LIMITS.maxBudgetINR),
  advanceINR: z.number().int("Amounts must be whole rupees").min(0).max(LIMITS.maxBudgetINR),
};

/**
 * A recorded cost comes from one of two places:
 * - a timeline task the user ticked (`taskId`), which books its budget line, or
 * - a budget line directly (`lineKey`), for costs no task covers
 *   (e.g. a photographer for an anniversary).
 */
export const DealSchema = z
  .union([
    z.strictObject({ taskId: z.string().regex(/^[a-z]-[a-z-]{2,20}$/, "Unknown task"), ...amounts }),
    z.strictObject({ lineKey: z.string().regex(/^[a-z][a-z-]{1,29}$/, "Unknown budget line"), ...amounts }),
  ])
  .refine((d) => d.advanceINR <= d.agreedINR, { message: "The advance can't be more than the agreed price", path: ["advanceINR"] });

export const DealsSchema = z.array(DealSchema).max(40);
export type Deal = z.infer<typeof DealSchema>;

export interface ReconciledLine {
  key: string;
  label: string;
  plannedINR: number;
  booked: boolean;
  agreedINR: number | null;
  advanceINR: number;
  dueINR: number;
  /** Positive = spent more than planned on this line; negative = saved. */
  differenceINR: number;
}

export interface Reconciliation {
  lines: ReconciledLine[];
  bookedCount: number;
  agreedINR: number;
  advanceINR: number;
  dueINR: number;
  /** Planned amount of the lines that have been booked. */
  bookedPlannedINR: number;
  /** Positive = bookings came in under plan in total. */
  savingsINR: number;
  contingencyPlannedINR: number;
  /** Contingency after absorbing savings or overspend; never below zero. */
  contingencyNowINR: number;
  overBudgetINR: number;
  /** What all budget lines add up to now: the budget plus any overspend. */
  projectedSpendINR: number;
  warnings: PlanWarning[];
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function reconcileBudget(budget: BudgetResult, tasks: readonly TimelineTask[], deals: readonly Deal[]): Reconciliation {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const lineKeys = new Set(budget.lines.map((l) => l.key));

  // Sum costs per budget line. Costs for unknown tasks/lines, tasks that don't book anything,
  // or the contingency buffer itself are ignored.
  const perKey = new Map<string, { agreed: number; advance: number }>();
  const seen = new Set<string>();
  for (const d of deals) {
    const id = "taskId" in d ? `task:${d.taskId}` : `line:${d.lineKey}`;
    if (seen.has(id)) continue; // one entry per task and per line; the first wins
    seen.add(id);
    const key = "taskId" in d ? taskById.get(d.taskId)?.books : d.lineKey;
    if (!key || !lineKeys.has(key) || key === "contingency") continue;
    const acc = perKey.get(key) ?? { agreed: 0, advance: 0 };
    acc.agreed += d.agreedINR;
    acc.advance += d.advanceINR;
    perKey.set(key, acc);
  }

  let agreedINR = 0, advanceINR = 0, bookedPlannedINR = 0;
  const lines: ReconciledLine[] = budget.lines.map((l) => {
    const deal = perKey.get(l.key);
    if (!deal) {
      return { key: l.key, label: l.label, plannedINR: l.amountINR, booked: false, agreedINR: null, advanceINR: 0, dueINR: 0, differenceINR: 0 };
    }
    agreedINR += deal.agreed;
    advanceINR += deal.advance;
    bookedPlannedINR += l.amountINR;
    return {
      key: l.key,
      label: l.label,
      plannedINR: l.amountINR,
      booked: true,
      agreedINR: deal.agreed,
      advanceINR: deal.advance,
      dueINR: deal.agreed - deal.advance,
      differenceINR: deal.agreed - l.amountINR,
    };
  });

  const savingsINR = bookedPlannedINR - agreedINR;
  const contingencyPlannedINR = budget.lines.find((l) => l.key === "contingency")?.amountINR ?? 0;
  const contingencyRaw = contingencyPlannedINR + savingsINR;
  const contingencyNowINR = Math.max(0, contingencyRaw);
  const overBudgetINR = Math.max(0, -contingencyRaw);

  const warnings: PlanWarning[] = [];
  if (overBudgetINR > 0) {
    warnings.push({
      code: "OVER_BUDGET",
      severity: "warning",
      message: `Your bookings are ${inr(-savingsINR)} above plan. The contingency buffer covers ${inr(contingencyPlannedINR)}, so you are ${inr(overBudgetINR)} over your total budget. Look for savings in the lines not yet booked.`,
    });
  } else if (savingsINR < 0) {
    warnings.push({
      code: "CONTINGENCY_USED",
      severity: "info",
      message: `Your bookings are ${inr(-savingsINR)} above plan. That came out of the contingency buffer, which now has ${inr(contingencyNowINR)} left.`,
    });
  } else if (savingsINR > 0) {
    warnings.push({
      code: "SAVINGS",
      severity: "info",
      message: `You've saved ${inr(savingsINR)} on bookings so far. It has been added to the contingency buffer, which now has ${inr(contingencyNowINR)}.`,
    });
  }

  return {
    lines,
    bookedCount: perKey.size,
    agreedINR,
    advanceINR,
    dueINR: agreedINR - advanceINR,
    bookedPlannedINR,
    savingsINR,
    contingencyPlannedINR,
    contingencyNowINR,
    overBudgetINR,
    projectedSpendINR: budget.totalINR + overBudgetINR,
    warnings,
  };
}
