import { allocateBudget, type BudgetResult, type PlanWarning } from "./budget.js";
import { DealsSchema, reconcileBudget, type Reconciliation } from "./deals.js";
import { buildTimeline, type TimelineResult } from "./timeline.js";
import { buildVendorChecklist, type VendorChecklistItem } from "./vendors.js";
import { buildSuggestions, type Suggestion } from "./suggest.js";
import { parsePlanInput, PlanInputError, type PlanInput } from "./validate.js";
import { z } from "zod";

const DoneSchema = z.array(z.string().regex(/^[a-z]-[a-z-]{2,20}$/)).max(60);

export interface Plan {
  input: PlanInput;
  budget: BudgetResult;
  timeline: TimelineResult;
  vendors: VendorChecklistItem[];
  /** Budget re-balanced from the bookings the user has recorded. */
  spending: Reconciliation;
  /** Next actions proposed by code; the user approves each one. */
  suggestions: Suggestion[];
  warnings: PlanWarning[];
}

/**
 * One call that validates input and builds every deterministic part of the plan.
 * `rawDeals` are the bookings the user recorded (agreed price, advance paid).
 */
export function buildPlan(raw: unknown, today: string, rawDeals: unknown = [], rawDone: unknown = []): Plan {
  const input = parsePlanInput(raw, today);
  const dealsResult = DealsSchema.safeParse(rawDeals ?? []);
  if (!dealsResult.success) {
    throw new PlanInputError(dealsResult.error.issues.map((i) => ({ field: ["deals", ...i.path].join("."), message: i.message })));
  }
  // Selectors decide which optional tasks/vendors apply: the sub-type plus any wedding functions.
  const selectors = [input.subType, ...(input.eventType === "wedding" ? input.subEvents : [])];

  const budget = allocateBudget(input.eventType, input.subType, input.totalBudgetINR, input.guestCount, input.cityTier);
  const doneResult = DoneSchema.safeParse(rawDone ?? []);
  if (!doneResult.success) throw new PlanInputError([{ field: "done", message: "Invalid list of completed tasks" }]);
  const timeline = buildTimeline(input.eventType, input.eventDate, today, selectors, new Set(doneResult.data));
  // A booking task is only useful if its budget line exists for this event type.
  const lineKeys = new Set(budget.lines.map((l) => l.key));
  for (const t of timeline.tasks) if (t.books && !lineKeys.has(t.books)) delete t.books;
  const vendors = buildVendorChecklist(input.eventType, selectors);
  // A vendor is only linked to a budget line this plan actually has.
  for (const v of vendors) if (v.line && !lineKeys.has(v.line)) delete v.line;
  const spending = reconcileBudget(budget, timeline.tasks, dealsResult.data);
  const done = new Set(doneResult.data);
  const suggestions = buildSuggestions(timeline, spending, vendors, done);

  return {
    input,
    budget,
    timeline,
    vendors,
    spending,
    suggestions,
    // The "food per guest is low" advice only helps before food is booked.
    warnings: [
      ...budget.warnings.filter((w) => !(w.code === "FOOD_BELOW_FLOOR" && spending.lines.some((l) => l.key === "catering" && l.booked))),
      ...timeline.warnings,
      ...spending.warnings,
    ],
  };
}
