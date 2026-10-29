import type { Reconciliation } from "./deals.js";
import type { TimelineResult } from "./timeline.js";
import type { VendorChecklistItem } from "./vendors.js";

/**
 * "Toran suggests": the next useful actions, worked out by code from the plan.
 * Each one is only a proposal. Nothing happens until the user taps the button,
 * and every action is a normal app action they could also do by hand.
 */

export type SuggestionAction =
  | { type: "open-vendors"; vendor: string }
  | { type: "mark-done"; taskId: string }
  | { type: "open-section"; section: "budget-card" | "timeline-card" | "vendors-card" }
  | { type: "download-calendar" }
  | { type: "download-backup" };

export interface Suggestion {
  id: string;
  title: string;
  why: string;
  /** Text on the approve button. */
  button: string;
  action: SuggestionAction;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** What every suggestion looks at. */
interface Ctx {
  timeline: TimelineResult;
  spending: Reconciliation;
  vendors: readonly VendorChecklistItem[];
  open: TimelineResult["tasks"];
}

const MS_PER_DAY = 86_400_000;
/** Balances become urgent this many days before the event. */
const BALANCE_DUE_DAYS = 10;

/** 1. The most urgent booking not made yet: go find a vendor for it. */
function suggestBooking({ spending, vendors, open }: Ctx): Suggestion | null {
  const booked = new Set(spending.lines.filter((l) => l.booked).map((l) => l.key));
  const task = open.find((t) => t.books && !booked.has(t.books) && t.status !== "upcoming");
  if (!task?.books) return null;
  const line = spending.lines.find((l) => l.key === task.books);
  const vendor = vendors.find((v) => v.line === task.books);
  const lateBy = Math.max(0, Math.round((Date.parse(task.dueDate) - Date.parse(task.idealDate)) / MS_PER_DAY));
  return {
    id: `book:${task.id}`,
    title: task.title,
    why:
      task.status === "late"
        ? `This was ideally done by ${fmt(task.idealDate)}, ${days(lateBy)} ago. Good ${(line?.label ?? task.books).toLowerCase()} vendors get booked early.`
        : `Due by ${fmt(task.dueDate)}. Planned spend: ${inr(line?.plannedINR ?? 0)}.`,
    button: vendor ? `Find ${vendor.category.toLowerCase()}` : "Open the timeline",
    action: vendor ? { type: "open-vendors", vendor: vendor.key } : { type: "open-section", section: "timeline-card" },
  };
}

/** 2. A task that doesn't book anything and is due now: one tap to tick it. */
function suggestChore({ open }: Ctx): Suggestion | null {
  const task = open.find((t) => !t.books && t.status !== "upcoming");
  if (!task) return null;
  return {
    id: `task:${task.id}`,
    title: task.title,
    why:
      task.status === "late"
        ? `Ideally done by ${fmt(task.idealDate)}. Tick it once it's done.`
        : `Due by ${fmt(task.dueDate)}. Tick it once it's done.`,
    button: "Mark as done",
    action: { type: "mark-done", taskId: task.id },
  };
}

/** 3. Over budget: show where the money still to be spent is. */
function suggestOverBudget({ spending }: Ctx): Suggestion | null {
  if (spending.overBudgetINR <= 0) return null;
  return {
    id: "over-budget",
    title: `You're ${inr(spending.overBudgetINR)} over budget`,
    why:
      spending.unbookedPlannedINR > 0
        ? `Bookings so far cost more than planned and the buffer is used up. ${inr(spending.unbookedPlannedINR)} is still to be booked: trimming those lines closes the gap.`
        : "Everything is booked and the total is above your budget. Check the advance and balance for each vendor.",
    button: "Review budget",
    action: { type: "open-section", section: "budget-card" },
  };
}

/** 4. Event close and balances still unpaid: keep cash ready. */
function suggestBalance({ timeline, spending }: Ctx): Suggestion | null {
  if (timeline.daysToGo > BALANCE_DUE_DAYS || spending.dueINR <= 0) return null;
  return {
    id: "balance-due",
    title: `Keep ${inr(spending.dueINR)} ready for vendor balances`,
    why: `Your event is ${timeline.daysToGo === 0 ? "today" : `in ${days(timeline.daysToGo)}`}. Vendors usually want the balance on or before the day.`,
    button: "See who to pay",
    action: { type: "open-section", section: "budget-card" },
  };
}

/** 5. Deadlines into the phone's own calendar, so reminders work without an account. */
function suggestCalendar({ open }: Ctx): Suggestion | null {
  if (!open.length) return null;
  return {
    id: "calendar",
    title: `Put ${open.length} deadline${open.length === 1 ? "" : "s"} in your calendar`,
    why: "Downloads a calendar file with every open task and the event day, with a reminder the evening before each.",
    button: "Add to calendar",
    action: { type: "download-calendar" },
  };
}

/** 6. Once money is recorded, a backup protects it from a cleared browser. */
function suggestBackup({ spending }: Ctx): Suggestion | null {
  if (!spending.bookedCount) return null;
  const n = spending.bookedCount;
  return {
    id: "backup",
    title: "Save a backup of your plan",
    why: `You've recorded ${n} booking${n === 1 ? "" : "s"}. A backup file keeps them safe if this browser is cleared.`,
    button: "Download backup",
    action: { type: "download-backup" },
  };
}

const RULES = [suggestBooking, suggestChore, suggestOverBudget, suggestBalance, suggestCalendar, suggestBackup];

/** Next useful actions, most urgent first. Each is only a proposal; nothing runs until the user taps. */
export function buildSuggestions(
  timeline: TimelineResult,
  spending: Reconciliation,
  vendors: readonly VendorChecklistItem[],
  done: ReadonlySet<string>,
): Suggestion[] {
  const ctx: Ctx = { timeline, spending, vendors, open: timeline.tasks.filter((t) => !done.has(t.id)) };
  return RULES.map((rule) => rule(ctx)).filter((x): x is Suggestion => x !== null);
}
