import { allocateBudget, type BudgetResult, type PlanWarning } from "./budget.js";
import { DealsSchema, reconcileBudget, type Reconciliation } from "./deals.js";
import { buildTimeline, type TimelineResult } from "./timeline.js";
import { buildVendorChecklist, type VendorChecklistItem } from "./vendors.js";
import { parsePlanInput, PlanInputError, type PlanInput } from "./validate.js";

export interface Plan {
  input: PlanInput;
  budget: BudgetResult;
  timeline: TimelineResult;
  vendors: VendorChecklistItem[];
  /** Budget re-balanced from the bookings the user has recorded. */
  spending: Reconciliation;
  warnings: PlanWarning[];
}

/**
 * One call that validates input and builds every deterministic part of the plan.
 * `rawDeals` are the bookings the user recorded (agreed price, advance paid).
 */
export function buildPlan(raw: unknown, today: string, rawDeals: unknown = []): Plan {
  const input = parsePlanInput(raw, today);
  const dealsResult = DealsSchema.safeParse(rawDeals ?? []);
  if (!dealsResult.success) {
    throw new PlanInputError(
      dealsResult.error.issues.map((i) => ({ field: ["deals", ...i.path].join("."), message: i.message })),
    );
  }
  // Selectors decide which optional tasks/vendors apply: the sub-type plus any wedding functions.
  const selectors = [input.subType, ...(input.eventType === "wedding" ? input.subEvents : [])];

  const budget = allocateBudget(input.eventType, input.subType, input.totalBudgetINR, input.guestCount, input.cityTier);
  const timeline = buildTimeline(input.eventType, input.eventDate, today, selectors);
  // A booking task is only useful if its budget line exists for this event type.
  const lineKeys = new Set(budget.lines.map((l) => l.key));
  for (const t of timeline.tasks) if (t.books && !lineKeys.has(t.books)) delete t.books;
  const vendors = buildVendorChecklist(input.eventType, selectors);
  const spending = reconcileBudget(budget, timeline.tasks, dealsResult.data);

  return {
    input,
    budget,
    timeline,
    vendors,
    spending,
    warnings: [...budget.warnings, ...timeline.warnings, ...spending.warnings],
  };
}
