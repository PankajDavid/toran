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

  it("records a cost directly on a budget line that no task books", () => {
    const anniv = { eventType: "party", subType: "anniversary", totalBudgetINR: 1_00_000, guestCount: 50, cityTier: 2, eventDate: "2027-01-10", diet: "veg" };
    const plan = buildPlan(anniv, TODAY);
    expect(plan.timeline.tasks.some((t) => t.books === "photo-video")).toBe(false); // the gap Pankaj found
    const s = buildPlan(anniv, TODAY, [{ lineKey: "photo-video", agreedINR: 2_000, advanceINR: 500 }]).spending;
    const photo = s.lines.find((l) => l.key === "photo-video")!;
    expect(photo).toMatchObject({ booked: true, agreedINR: 2_000, advanceINR: 500, dueINR: 1_500, differenceINR: 2_000 - 7_000 });
    expect(s.savingsINR).toBe(5_000);
  });

  it("adds a line cost to costs booked through tasks on the same line", () => {
    const s = buildPlan(wedding, TODAY, [
      { taskId: "w-makeup", agreedINR: 40_000, advanceINR: 0 },
      { lineKey: "beauty", agreedINR: 8_000, advanceINR: 8_000 },
    ]).spending;
    expect(s.lines.find((l) => l.key === "beauty")!.agreedINR).toBe(48_000);
  });

  it("flags the same amount entered via the timeline and as a line cost (Pankaj's Diwali mela case)", () => {
    const mela = { eventType: "community", subType: "diwali-mela", totalBudgetINR: 3_00_000, guestCount: 800, cityTier: 2, eventDate: "2027-01-10" };
    const s = buildPlan(mela, TODAY, [
      { taskId: "c-venue", agreedINR: 60_000, advanceINR: 20_000 },
      { lineKey: "venue", agreedINR: 60_000, advanceINR: 20_000 },
    ]).spending;
    expect(s.lines.find((l) => l.key === "venue")!.agreedINR).toBe(1_20_000); // still summed, never silently dropped
    expect(s.warnings.map((w) => w.code)).toContain("POSSIBLE_DUPLICATE");
    expect(s.warnings.find((w) => w.code === "POSSIBLE_DUPLICATE")!.message).toContain("Ground & tent");
  });

  it("does not flag a genuinely different extra cost", () => {
    const s = buildPlan(wedding, TODAY, [
      { taskId: "w-makeup", agreedINR: 40_000, advanceINR: 0 },
      { lineKey: "beauty", agreedINR: 8_000, advanceINR: 0 },
    ]).spending;
    expect(s.warnings.map((w) => w.code)).not.toContain("POSSIBLE_DUPLICATE");
  });

  it("ignores line costs for unknown lines and for the contingency buffer", () => {
    const s = buildPlan(wedding, TODAY, [
      { lineKey: "spaceship", agreedINR: 1, advanceINR: 0 },
      { lineKey: "contingency", agreedINR: 1, advanceINR: 0 },
    ]).spending;
    expect(s.bookedCount).toBe(0);
  });

  it("rejects bad booking input", () => {
    for (const bad of [
      [{ taskId: "w-venue", agreedINR: 1000, advanceINR: 2000 }], // advance > agreed
      [{ taskId: "w-venue", agreedINR: -5, advanceINR: 0 }],
      [{ taskId: "w-venue", agreedINR: 10.5, advanceINR: 0 }],
      [{ taskId: "<script>", agreedINR: 1, advanceINR: 0 }],
      [{ taskId: "w-venue", agreedINR: 1, advanceINR: 0, extra: 1 }],
      [{ taskId: "w-venue", lineKey: "venue", agreedINR: 1, advanceINR: 0 }], // both at once
      [{ lineKey: "Venue!", agreedINR: 1, advanceINR: 0 }],
      "nope",
    ]) {
      expect(() => buildPlan(wedding, TODAY, bad)).toThrow(PlanInputError);
    }
  });
});
