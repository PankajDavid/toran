import { describe, expect, it } from "vitest";
import { buildPlan, PlanInputError } from "./index.js";

const TODAY = "2026-10-27";
const wedding = {
  eventType: "wedding", subType: "punjabi", subEvents: ["mehendi", "ceremony"],
  totalBudgetINR: 15_00_000, guestCount: 300, cityTier: 2, eventDate: "2027-02-14", diet: "veg",
};
// Planned: venue ₹3,00,000 (20%), catering ₹4,20,000 (28%), contingency ₹75,000 (5%), beauty ₹60,000 (4%).

describe("booking tasks link to budget lines", () => {
  it("marks the right tasks as bookings", () => {
    const plan = buildPlan(wedding, TODAY);
    const books = Object.fromEntries(plan.timeline.tasks.filter((t) => t.books).map((t) => [t.id, t.books]));
    expect(books["w-venue"]).toBe("venue");
    expect(books["w-caterer"]).toBe("catering");
    expect(books["w-mehendi"]).toBe("beauty");
    expect(books["w-budget"]).toBeUndefined();
  });

  it("never links a task to a budget line the event doesn't have", () => {
    for (const sub of ["jagran", "langar", "diwali-mela", "rwa-function", "other"]) {
      const plan = buildPlan({ eventType: "community", subType: sub, totalBudgetINR: 2_00_000, guestCount: 300, cityTier: 2, eventDate: "2027-01-10" }, TODAY);
      const keys = new Set(plan.budget.lines.map((l) => l.key));
      for (const t of plan.timeline.tasks) if (t.books) expect(keys.has(t.books)).toBe(true);
    }
  });
});

describe("reconcileBudget — deal closed", () => {
  it("with no bookings, nothing changes", () => {
    const s = buildPlan(wedding, TODAY).spending;
    expect(s.bookedCount).toBe(0);
    expect(s.contingencyNowINR).toBe(75_000);
    expect(s.warnings).toEqual([]);
  });

  it("savings go into the contingency buffer", () => {
    const s = buildPlan(wedding, TODAY, [{ taskId: "w-venue", agreedINR: 2_80_000, advanceINR: 1_00_000 }]).spending;
    const venue = s.lines.find((l) => l.key === "venue")!;
    expect(venue).toMatchObject({ booked: true, agreedINR: 2_80_000, advanceINR: 1_00_000, dueINR: 1_80_000, differenceINR: -20_000 });
    expect(s.savingsINR).toBe(20_000);
    expect(s.contingencyNowINR).toBe(95_000);
    expect(s.warnings[0].code).toBe("SAVINGS");
  });

  it("overspend comes out of contingency first", () => {
    const s = buildPlan(wedding, TODAY, [{ taskId: "w-caterer", agreedINR: 4_70_000, advanceINR: 0 }]).spending;
    expect(s.contingencyNowINR).toBe(25_000);
    expect(s.overBudgetINR).toBe(0);
    expect(s.warnings[0].code).toBe("CONTINGENCY_USED");
  });

  it("beyond contingency, shows exactly how much over budget", () => {
    const s = buildPlan(wedding, TODAY, [
      { taskId: "w-venue", agreedINR: 3_50_000, advanceINR: 50_000 },
      { taskId: "w-caterer", agreedINR: 5_00_000, advanceINR: 1_00_000 },
    ]).spending;
    // Over plan by 50,000 + 80,000 = 1,30,000; contingency 75,000 → 55,000 over.
    expect(s.overBudgetINR).toBe(55_000);
    expect(s.contingencyNowINR).toBe(0);
    expect(s.agreedINR).toBe(8_50_000);
    expect(s.advanceINR).toBe(1_50_000);
    expect(s.dueINR).toBe(7_00_000);
    expect(s.warnings[0].code).toBe("OVER_BUDGET");
    expect(s.warnings[0].message).toContain("₹55,000");
  });

  it("two tasks that book the same line add up (makeup + mehendi → beauty)", () => {
    const s = buildPlan(wedding, TODAY, [
      { taskId: "w-makeup", agreedINR: 40_000, advanceINR: 10_000 },
      { taskId: "w-mehendi", agreedINR: 15_000, advanceINR: 5_000 },
    ]).spending;
    const beauty = s.lines.find((l) => l.key === "beauty")!;
    expect(beauty.agreedINR).toBe(55_000);
    expect(beauty.differenceINR).toBe(-5_000);
  });

  it("ignores deals for unknown tasks or tasks that don't book anything", () => {
    const s = buildPlan(wedding, TODAY, [
      { taskId: "w-budget", agreedINR: 1, advanceINR: 0 },
      { taskId: "x-nothing", agreedINR: 1, advanceINR: 0 },
    ]).spending;
    expect(s.bookedCount).toBe(0);
  });

  it("counts each task once", () => {
    const s = buildPlan(wedding, TODAY, [
      { taskId: "w-venue", agreedINR: 2_00_000, advanceINR: 0 },
      { taskId: "w-venue", agreedINR: 9_00_000, advanceINR: 0 },
    ]).spending;
    expect(s.agreedINR).toBe(2_00_000);
  });

  it("every rupee is accounted for: booked + unbooked + contingency + over = total", () => {
    const s = buildPlan(wedding, TODAY, [
      { taskId: "w-venue", agreedINR: 3_37_123, advanceINR: 0 },
      { taskId: "w-caterer", agreedINR: 3_99_999, advanceINR: 0 },
    ]).spending;
    const unbooked = s.lines.filter((l) => !l.booked && l.key !== "contingency").reduce((a, l) => a + l.plannedINR, 0);
    expect(s.agreedINR + unbooked + s.contingencyNowINR - s.overBudgetINR).toBe(15_00_000);
    // and the table's total equals the sum of the amounts it shows
    expect(s.agreedINR + unbooked + s.contingencyNowINR).toBe(s.projectedSpendINR);
  });

  it("rejects bad booking input", () => {
    for (const bad of [
      [{ taskId: "w-venue", agreedINR: 1000, advanceINR: 2000 }], // advance > agreed
      [{ taskId: "w-venue", agreedINR: -5, advanceINR: 0 }],
      [{ taskId: "w-venue", agreedINR: 10.5, advanceINR: 0 }],
      [{ taskId: "<script>", agreedINR: 1, advanceINR: 0 }],
      [{ taskId: "w-venue", agreedINR: 1, advanceINR: 0, extra: 1 }],
      "nope",
    ]) {
      expect(() => buildPlan(wedding, TODAY, bad)).toThrow(PlanInputError);
    }
  });
});
