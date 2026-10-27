import {
  ALLOCATIONS,
  FOOD_FLOOR_PER_GUEST,
  type CategoryShare,
  type CityTier,
  type EventType,
} from "./config.js";

export interface BudgetLine {
  key: string;
  label: string;
  amountINR: number;
  /** Share of the total, in basis points (2800 = 28%). */
  bp: number;
}

export interface PlanWarning {
  code: string;
  severity: "info" | "warning";
  message: string;
}

export interface BudgetResult {
  totalINR: number;
  guestCount: number;
  lines: BudgetLine[];
  perGuestINR: number;
  foodPerGuestINR: number;
  foodFloorPerGuestINR: number;
  warnings: PlanWarning[];
}

export function getAllocation(eventType: EventType, subType: string): CategoryShare[] {
  const shares = ALLOCATIONS[`${eventType}:${subType}`];
  if (!shares) throw new RangeError(`No allocation for ${eventType}:${subType}`);
  return shares;
}

/**
 * Splits a whole-rupee total across shares so the parts add up EXACTLY to the total.
 * Largest-remainder method: everyone gets the rounded-down amount, then the
 * leftover rupees go one each to the lines with the biggest dropped fraction
 * (ties go to the earlier line, so results are stable).
 */
export function splitExactly(totalINR: number, shares: readonly { bp: number }[]): number[] {
  if (!Number.isInteger(totalINR) || totalINR < 0) throw new RangeError("Total must be a whole, non-negative rupee amount");
  const bpSum = shares.reduce((s, x) => s + x.bp, 0);
  if (bpSum !== 10_000) throw new RangeError(`Shares must add up to 10000 bp, got ${bpSum}`);

  const base = shares.map((s) => Math.floor((totalINR * s.bp) / 10_000));
  let leftover = totalINR - base.reduce((a, b) => a + b, 0);
  const order = shares
    .map((s, i) => ({ i, frac: (totalINR * s.bp) % 10_000 }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; leftover > 0; k++, leftover--) base[order[k % order.length].i] += 1;
  return base;
}

function foodFloor(eventType: EventType, subType: string, tier: CityTier): number {
  const table = FOOD_FLOOR_PER_GUEST[`${eventType}:${subType}`] ?? FOOD_FLOOR_PER_GUEST[eventType];
  return table[tier];
}

const formatINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function allocateBudget(
  eventType: EventType,
  subType: string,
  totalBudgetINR: number,
  guestCount: number,
  cityTier: CityTier,
): BudgetResult {
  if (!Number.isInteger(guestCount) || guestCount < 1) throw new RangeError("Guest count must be a whole number of at least 1");
  const shares = getAllocation(eventType, subType);
  const amounts = splitExactly(totalBudgetINR, shares);
  const lines = shares.map((s, i) => ({ key: s.key, label: s.label, amountINR: amounts[i], bp: s.bp }));

  const foodIndex = shares.findIndex((s) => s.food);
  const foodAmount = foodIndex >= 0 ? amounts[foodIndex] : 0;
  const foodPerGuestINR = Math.floor(foodAmount / guestCount);
  const floor = foodFloor(eventType, subType, cityTier);

  const warnings: PlanWarning[] = [];
  if (foodPerGuestINR < floor) {
    const neededTotal = Math.ceil((floor * guestCount * 10_000) / shares[foodIndex].bp);
    warnings.push({
      code: "FOOD_BELOW_FLOOR",
      severity: "warning",
      message:
        `${shares[foodIndex].label} works out to ${formatINR(foodPerGuestINR)} per guest, ` +
        `below the usual minimum of about ${formatINR(floor)} for this kind of event in a tier-${cityTier} city. ` +
        `Consider about ${formatINR(neededTotal)} in total, or fewer guests.`,
    });
  }

  return {
    totalINR: totalBudgetINR,
    guestCount,
    lines,
    perGuestINR: Math.floor(totalBudgetINR / guestCount),
    foodPerGuestINR,
    foodFloorPerGuestINR: floor,
    warnings,
  };
}
