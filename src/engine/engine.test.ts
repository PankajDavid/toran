import { describe, expect, it } from "vitest";
import {
  ALLOCATIONS,
  BIRTHDAY_KINDS,
  COMMUNITY_KINDS,
  WEDDING_STYLES,
  addYears,
  allocateBudget,
  buildPlan,
  buildTimeline,
  buildVendorChecklist,
  isValidIsoDate,
  parsePlanInput,
  PlanInputError,
  splitExactly,
  todayInIndia,
  type CityTier,
  type EventType,
} from "./index.js";

const TODAY = "2026-10-27";
const ALL_COMBOS: [EventType, string][] = [
  ...WEDDING_STYLES.map((s) => ["wedding", s] as [EventType, string]),
  ...BIRTHDAY_KINDS.map((s) => ["birthday", s] as [EventType, string]),
  ...COMMUNITY_KINDS.map((s) => ["community", s] as [EventType, string]),
];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("config", () => {
  it.each(Object.entries(ALLOCATIONS))("%s shares add up to exactly 100%%", (_key, shares) => {
    expect(sum(shares.map((s) => s.bp))).toBe(10_000);
  });

  it.each(Object.entries(ALLOCATIONS))("%s has exactly one food line and unique keys", (_key, shares) => {
    expect(shares.filter((s) => s.food)).toHaveLength(1);
    expect(new Set(shares.map((s) => s.key)).size).toBe(shares.length);
  });

  it("has an allocation for every event type and sub-type", () => {
    for (const [type, sub] of ALL_COMBOS) expect(ALLOCATIONS[`${type}:${sub}`]).toBeDefined();
  });
});

describe("splitExactly", () => {
  it("never loses or invents a rupee, across awkward totals", () => {
    const shares = ALLOCATIONS["wedding:punjabi"];
    for (const total of [1_000, 1_001, 9_999, 12_34_567, 5_00_00_000, 7_77_777]) {
      expect(sum(splitExactly(total, shares))).toBe(total);
    }
  });

  it("gives each line within 1 rupee of its exact share", () => {
    const shares = ALLOCATIONS["community:diwali-mela"];
    const total = 3_33_333;
    splitExactly(total, shares).forEach((amt, i) => {
      expect(Math.abs(amt - (total * shares[i].bp) / 10_000)).toBeLessThan(1);
    });
  });

  it("is deterministic (same input, same output)", () => {
    const shares = ALLOCATIONS["birthday:kid"];
    expect(splitExactly(10_007, shares)).toEqual(splitExactly(10_007, shares));
  });

  it("rejects shares that do not add up to 100%", () => {
    expect(() => splitExactly(1000, [{ bp: 5000 }, { bp: 4000 }])).toThrow(/10000/);
  });

  it("rejects fractional or negative totals", () => {
    expect(() => splitExactly(100.5, [{ bp: 10_000 }])).toThrow();
    expect(() => splitExactly(-1, [{ bp: 10_000 }])).toThrow();
  });
});

describe("allocateBudget", () => {
  it.each(ALL_COMBOS)("%s/%s lines sum exactly to the total for many budgets", (type, sub) => {
    for (const total of [1_000, 49_999, 2_50_000, 18_75_321, 5_00_00_000]) {
      const r = allocateBudget(type, sub, total, 100, 2);
      expect(sum(r.lines.map((l) => l.amountINR))).toBe(total);
      expect(r.lines.every((l) => Number.isInteger(l.amountINR) && l.amountINR >= 0)).toBe(true);
    }
  });

  it("computes per-guest and food-per-guest figures", () => {
    const r = allocateBudget("wedding", "punjabi", 20_00_000, 400, 2);
    expect(r.perGuestINR).toBe(5_000);
    expect(r.lines.find((l) => l.key === "catering")!.amountINR).toBe(5_60_000);
    expect(r.foodPerGuestINR).toBe(1_400);
    expect(r.warnings).toHaveLength(0);
  });

  it("warns when food per guest is below the floor, with a suggested total", () => {
    // ₹1,00,000 wedding for 500 guests in a metro: ₹56 of food per guest.
    const r = allocateBudget("wedding", "other", 1_00_000, 500, 1);
    expect(r.warnings[0].code).toBe("FOOD_BELOW_FLOOR");
    // Floor 900 × 500 guests ÷ 28% = ₹16,07,143
    expect(r.warnings[0].message).toContain("₹16,07,143");
  });

  it("uses the langar-specific food floor, not the generic community one", () => {
    const r = allocateBudget("community", "langar", 50_000, 400, 3); // ₹56/guest food, floor 50
    expect(r.foodFloorPerGuestINR).toBe(50);
    expect(r.warnings).toHaveLength(0);
  });

  it("city tier changes the food floor", () => {
    const tiers = ([1, 2, 3] as CityTier[]).map((t) => allocateBudget("birthday", "adult", 50_000, 50, t).foodFloorPerGuestINR);
    expect(tiers).toEqual([500, 400, 300]);
  });

  it("rejects zero, negative or fractional guests", () => {
    expect(() => allocateBudget("birthday", "kid", 10_000, 0, 2)).toThrow();
    expect(() => allocateBudget("birthday", "kid", 10_000, -5, 2)).toThrow();
    expect(() => allocateBudget("birthday", "kid", 10_000, 2.5, 2)).toThrow();
  });

  it("rejects unknown sub-types", () => {
    expect(() => allocateBudget("wedding", "vegas", 10_000, 10, 2)).toThrow(/No allocation/);
  });
});

describe("buildTimeline", () => {
  it("schedules tasks backwards from a far-off event with nothing late", () => {
    const t = buildTimeline("wedding", "2027-10-27", TODAY, ["sangeet"]);
    expect(t.compressed).toBe(false);
    expect(t.daysToGo).toBe(365);
    const venue = t.tasks.find((x) => x.id === "w-venue")!;
    expect(venue.dueDate).toBe("2027-05-30"); // 150 days before
    expect(venue.status).toBe("upcoming");
  });

  it("returns tasks in date order", () => {
    const dates = buildTimeline("community", "2027-01-15", TODAY, ["jagran"]).tasks.map((x) => x.dueDate);
    expect(dates).toEqual([...dates].sort());
  });

  it("compresses an event tomorrow: past-due tasks move to today and are flagged late", () => {
    const t = buildTimeline("birthday", "2026-10-28", TODAY, ["kid"]);
    expect(t.daysToGo).toBe(1);
    expect(t.compressed).toBe(true);
    for (const task of t.tasks) expect(task.dueDate >= TODAY).toBe(true);
    expect(t.tasks.find((x) => x.id === "b-venue")!.status).toBe("late");
    expect(t.tasks.find((x) => x.id === "b-day")!).toMatchObject({ dueDate: TODAY, status: "due-soon" });
    expect(t.warnings[0].code).toBe("TIMELINE_COMPRESSED");
  });

  it("allows an event today", () => {
    expect(buildTimeline("birthday", TODAY, TODAY).daysToGo).toBe(0);
  });

  it("rejects an event in the past", () => {
    expect(() => buildTimeline("birthday", "2026-10-26", TODAY)).toThrow(/past/);
  });

  it("only includes function-specific tasks when that function is chosen", () => {
    const without = buildTimeline("wedding", "2027-06-01", TODAY, ["ceremony"]).tasks.map((x) => x.id);
    const withMehendi = buildTimeline("wedding", "2027-06-01", TODAY, ["ceremony", "mehendi"]).tasks.map((x) => x.id);
    expect(without).not.toContain("w-mehendi");
    expect(withMehendi).toContain("w-mehendi");
  });

  it("handles month and year boundaries correctly", () => {
    const t = buildTimeline("birthday", "2027-01-05", "2026-12-20");
    expect(t.tasks.find((x) => x.id === "b-cake")!.dueDate).toBe("2026-12-26");
  });
});

describe("buildVendorChecklist", () => {
  it.each(ALL_COMBOS)("%s/%s: every category has 3–5 questions", (type, sub) => {
    for (const item of buildVendorChecklist(type, [sub, "haldi", "mehendi", "sangeet", "ceremony", "reception"])) {
      expect(item.questions.length).toBeGreaterThanOrEqual(3);
      expect(item.questions.length).toBeLessThanOrEqual(5);
    }
  });

  it("never contains phone numbers, URLs or emails (no invented vendors)", () => {
    const text = JSON.stringify(ALL_COMBOS.map(([t, s]) => buildVendorChecklist(t, [s, "mehendi", "sangeet", "ceremony"])));
    expect(text).not.toMatch(/\d{10}|\+91|https?:|www\.|@[a-z]/i);
  });

  it("includes the bhajan mandali only for a jagran", () => {
    expect(buildVendorChecklist("community", ["jagran"]).map((v) => v.key)).toContain("mandali");
    expect(buildVendorChecklist("community", ["langar"]).map((v) => v.key)).not.toContain("mandali");
  });

  it("returns copies, so callers cannot change the templates", () => {
    buildVendorChecklist("birthday", ["kid"])[0].questions.push("tampered");
    expect(buildVendorChecklist("birthday", ["kid"])[0].questions).not.toContain("tampered");
  });
});

describe("dates", () => {
  it("rejects impossible or badly formatted dates", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "27-10-2026", "2026-1-5", "", "2026-10-27T00:00"]) {
      expect(isValidIsoDate(bad)).toBe(false);
    }
    expect(isValidIsoDate("2028-02-29")).toBe(true);
  });

  it("clamps 29 Feb when adding years", () => {
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
  });

  it("uses India time for today (late UTC evening is already the next day in IST)", () => {
    expect(todayInIndia(new Date("2026-10-27T20:00:00Z"))).toBe("2026-10-28");
  });
});

describe("parsePlanInput", () => {
  const good = {
    eventType: "wedding",
    subType: "punjabi",
    subEvents: ["mehendi", "sangeet", "ceremony", "reception"],
    totalBudgetINR: 25_00_000,
    guestCount: 400,
    cityTier: 2,
    eventDate: "2027-02-14",
  };
  const fieldsOf = (raw: unknown) => {
    try {
      parsePlanInput(raw, TODAY);
      return [];
    } catch (e) {
      expect(e).toBeInstanceOf(PlanInputError);
      return (e as PlanInputError).issues.map((i) => i.field);
    }
  };

  it("accepts a valid wedding", () => {
    expect(parsePlanInput(good, TODAY).eventType).toBe("wedding");
  });

  it("rejects budgets outside ₹1,000 – ₹5 crore and fractional rupees", () => {
    expect(fieldsOf({ ...good, totalBudgetINR: 999 })).toContain("totalBudgetINR");
    expect(fieldsOf({ ...good, totalBudgetINR: 5_00_00_001 })).toContain("totalBudgetINR");
    expect(fieldsOf({ ...good, totalBudgetINR: 1000.5 })).toContain("totalBudgetINR");
    expect(fieldsOf({ ...good, totalBudgetINR: "100000" })).toContain("totalBudgetINR");
  });

  it("rejects 0 guests and more than 5,000", () => {
    expect(fieldsOf({ ...good, guestCount: 0 })).toContain("guestCount");
    expect(fieldsOf({ ...good, guestCount: 5_001 })).toContain("guestCount");
  });

  it("rejects past dates and dates more than 3 years ahead", () => {
    expect(fieldsOf({ ...good, eventDate: "2026-10-26" })).toEqual(["eventDate"]);
    expect(fieldsOf({ ...good, eventDate: "2029-10-28" })).toEqual(["eventDate"]);
    expect(fieldsOf({ ...good, eventDate: "2029-10-27" })).toEqual([]);
  });

  it("rejects a sub-type that belongs to another event type", () => {
    expect(fieldsOf({ ...good, subType: "langar" })).toContain("subType");
  });

  it("requires at least one wedding function, and removes duplicates", () => {
    expect(fieldsOf({ ...good, subEvents: [] })).toContain("subEvents");
    expect(parsePlanInput({ ...good, subEvents: ["haldi", "haldi"] }, TODAY)).toMatchObject({ subEvents: ["haldi"] });
  });

  it("rejects unknown extra fields (no smuggled data, e.g. a client-side 'price')", () => {
    expect(fieldsOf({ ...good, price: 1 })).not.toEqual([]);
  });

  it("rejects garbage", () => {
    for (const bad of [null, undefined, "x", 42, [], { eventType: "funeral" }]) expect(fieldsOf(bad)).not.toEqual([]);
  });
});

describe("buildPlan", () => {
  it("builds a complete plan whose budget always balances", () => {
    const plan = buildPlan(
      { eventType: "community", subType: "diwali-mela", totalBudgetINR: 3_00_000, guestCount: 800, cityTier: 2, eventDate: "2026-11-08" },
      TODAY,
    );
    expect(sum(plan.budget.lines.map((l) => l.amountINR))).toBe(3_00_000);
    expect(plan.timeline.tasks.length).toBeGreaterThan(0);
    expect(plan.vendors.map((v) => v.key)).toContain("safety");
    expect(plan.warnings.map((w) => w.code)).toContain("TIMELINE_COMPRESSED"); // 12 days away
  });
});
