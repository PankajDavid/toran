import { allocateBudget, type BudgetResult, type PlanWarning } from "./budget.js";
import { buildTimeline, type TimelineResult } from "./timeline.js";
import { buildVendorChecklist, type VendorChecklistItem } from "./vendors.js";
import { parsePlanInput, type PlanInput } from "./validate.js";

export interface Plan {
  input: PlanInput;
  budget: BudgetResult;
  timeline: TimelineResult;
  vendors: VendorChecklistItem[];
  warnings: PlanWarning[];
}

/** One call that validates input and builds every deterministic part of the plan. */
export function buildPlan(raw: unknown, today: string): Plan {
  const input = parsePlanInput(raw, today);
  // Selectors decide which optional tasks/vendors apply: the sub-type plus any wedding functions.
  const selectors = [input.subType, ...(input.eventType === "wedding" ? input.subEvents : [])];

  const budget = allocateBudget(input.eventType, input.subType, input.totalBudgetINR, input.guestCount, input.cityTier);
  const timeline = buildTimeline(input.eventType, input.eventDate, today, selectors);
  const vendors = buildVendorChecklist(input.eventType, selectors);

  return { input, budget, timeline, vendors, warnings: [...budget.warnings, ...timeline.warnings] };
}
