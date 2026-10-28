import { describe, expect, it } from "vitest";
import { buildPlan } from "./plan.js";
import { buildCalendar, foldLine, icsText } from "./ics.js";

const TODAY = "2026-10-28";
const wedding = { eventType: "wedding", subType: "punjabi", subEvents: ["ceremony"], totalBudgetINR: 20_00_000, guestCount: 250, cityTier: 2, eventDate: "2027-02-14" };
const ids = (p: ReturnType<typeof buildPlan>) => p.suggestions.map((s) => s.id);

describe("Toran suggests", () => {
  it("proposes the most urgent unbooked booking, with the vendor to find", () => {
    const p = buildPlan(wedding, TODAY);
    const s = p.suggestions[0];
    expect(s.id).toBe("book:w-venue");
    expect(s.action).toEqual({ type: "open-vendors", vendor: "venue" });
    expect(s.why).toContain("ago");
  });
  it("moves on once that line is booked", () => {
    const p = buildPlan(wedding, TODAY, [{ taskId: "w-venue", agreedINR: 4_00_000, advanceINR: 1_00_000 }], ["w-venue"]);
    expect(ids(p)[0]).toBe("book:w-caterer");
    expect(ids(p)).toContain("backup");
  });
  it("offers to tick an overdue non-booking task", () => {
    const p = buildPlan(wedding, TODAY);
    expect(p.suggestions.find((s) => s.id === "task:w-budget")?.action).toEqual({ type: "mark-done", taskId: "w-budget" });
    expect(ids(buildPlan(wedding, TODAY, [], ["w-budget"]))).not.toContain("task:w-budget");
  });
  it("flags over budget only when it is", () => {
    expect(ids(buildPlan(wedding, TODAY))).not.toContain("over-budget");
    const over = buildPlan(wedding, TODAY, [{ taskId: "w-venue", agreedINR: 9_00_000, advanceINR: 0 }], ["w-venue"]);
    expect(over.suggestions.find((s) => s.id === "over-budget")?.title).toContain("over budget");
  });
  it("asks to keep balances ready in the last 10 days", () => {
    const soon = { ...wedding, eventDate: "2026-11-04" };
    const p = buildPlan(soon, TODAY, [{ taskId: "w-venue", agreedINR: 4_00_000, advanceINR: 1_00_000 }], ["w-venue"]);
    expect(p.suggestions.find((s) => s.id === "balance-due")?.title).toContain("₹3,00,000");
    expect(ids(buildPlan(wedding, TODAY, [{ taskId: "w-venue", agreedINR: 4_00_000, advanceINR: 1_00_000 }], ["w-venue"]))).not.toContain("balance-due");
  });
  it("never invents an amount: every rupee figure comes from the plan", () => {
    const p = buildPlan(wedding, TODAY);
    const allowed = new Set([...p.spending.lines.map((l) => l.plannedINR), p.spending.dueINR, p.spending.overBudgetINR, p.spending.unbookedPlannedINR].map((n) => `₹${n.toLocaleString("en-IN")}`));
    for (const s of p.suggestions) for (const m of `${s.title} ${s.why}`.match(/₹[\d,]+/g) ?? []) expect(allowed.has(m), m).toBe(true);
  });
});

describe("calendar file", () => {
  const p = buildPlan(wedding, TODAY);
  const ics = buildCalendar(p.timeline, { title: "Wedding (Toran)", done: new Set(["w-budget"]), stamp: new Date("2026-10-28T10:00:00Z") });
  it("is a valid VCALENDAR with CRLF line endings", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });
  it("has one event per open task plus the event day, each with a reminder", () => {
    const events = ics.match(/BEGIN:VEVENT/g)!.length;
    expect(events).toBe(p.timeline.tasks.length - 1 + 1);
    expect(ics.match(/BEGIN:VALARM/g)!.length).toBe(events);
    expect(ics).not.toContain("w-budget-");
    expect(ics).toContain("DTSTART;VALUE=DATE:20270214");
    expect(ics).toContain("DTEND;VALUE=DATE:20270215");
  });
  it("escapes text and folds long lines without breaking characters", () => {
    expect(icsText("a,b;c\\d\ne")).toBe(String.raw`a\,b\;c\\d\ne`);
    const long = "SUMMARY:" + "मेहंदी ".repeat(30);
    const folded = foldLine(long);
    for (const l of folded.split("\r\n")) expect(Buffer.byteLength(l, "utf8")).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n ").join("")).toBe(long);
  });
});
