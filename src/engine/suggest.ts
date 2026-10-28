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

export function buildSuggestions(
  timeline: TimelineResult,
  spending: Reconciliation,
  vendors: readonly VendorChecklistItem[],
  done: ReadonlySet<string>,
): Suggestion[] {
  const out: Suggestion[] = [];
  const open = timeline.tasks.filter((t) => !done.has(t.id));
  const bookedLines = new Set(spending.lines.filter((l) => l.booked).map((l) => l.key));
  const label = (key: string) => spending.lines.find((l) => l.key === key)?.label ?? key;

  // 1. The most urgent booking not made yet: go find a vendor for it.
  const booking = open.find((t) => t.books && !bookedLines.has(t.books) && t.status !== "upcoming");
  if (booking?.books) {
    const vendor = vendors.find((v) => v.line === booking.books);
    const late = booking.status === "late";
    const lateBy = late ? Math.max(0, Math.round((Date.parse(booking.dueDate) - Date.parse(booking.idealDate)) / 86_400_000)) : 0;
    out.push({
      id: `book:${booking.id}`,
      title: `${booking.title}`,
      why: late
        ? `This was ideally done by ${fmt(booking.idealDate)}, ${days(lateBy)} ago. Good ${label(booking.books).toLowerCase()} vendors get booked early.`
        : `Due by ${fmt(booking.dueDate)}. Planned spend: ${inr(spending.lines.find((l) => l.key === booking.books)?.plannedINR ?? 0)}.`,
      button: vendor ? `Find ${vendor.category.toLowerCase()}` : "Open the timeline",
      action: vendor ? { type: "open-vendors", vendor: vendor.key } : { type: "open-section", section: "timeline-card" },
    });
  }

  // 2. A task that doesn't book anything and is due this week: one tap to tick it.
  const chore = open.find((t) => !t.books && t.status !== "upcoming");
  if (chore) {
    out.push({
      id: `task:${chore.id}`,
      title: chore.title,
      why:
        chore.status === "late"
          ? `Ideally done by ${fmt(chore.idealDate)}. Tick it once it's done.`
          : `Due by ${fmt(chore.dueDate)}. Tick it once it's done.`,
      button: "Mark as done",
      action: { type: "mark-done", taskId: chore.id },
    });
  }

  // 3. Over budget: show where the money still to be spent is.
  if (spending.overBudgetINR > 0) {
    out.push({
      id: "over-budget",
      title: `You're ${inr(spending.overBudgetINR)} over budget`,
      why:
        spending.unbookedPlannedINR > 0
          ? `Bookings so far cost more than planned and the buffer is used up. ${inr(spending.unbookedPlannedINR)} is still to be booked: trimming those lines closes the gap.`
          : "Everything is booked and the total is above your budget. Check the advance and balance for each vendor.",
      button: "Review budget",
      action: { type: "open-section", section: "budget-card" },
    });
  }

  // 4. Event close and balances still unpaid: keep cash ready.
  if (timeline.daysToGo <= 10 && spending.dueINR > 0) {
    out.push({
      id: "balance-due",
      title: `Keep ${inr(spending.dueINR)} ready for vendor balances`,
      why: `Your event is ${timeline.daysToGo === 0 ? "today" : `in ${days(timeline.daysToGo)}`}. Vendors usually want the balance on or before the day.`,
      button: "See who to pay",
      action: { type: "open-section", section: "budget-card" },
    });
  }

  // 5. Deadlines into the phone's own calendar, so reminders work without an account.
  if (open.length > 0) {
    out.push({
      id: "calendar",
      title: `Put ${open.length} deadline${open.length === 1 ? "" : "s"} in your calendar`,
      why: "Downloads a calendar file with every open task and the event day, with a reminder the evening before each.",
      button: "Add to calendar",
      action: { type: "download-calendar" },
    });
  }

  // 6. Once money is recorded, a backup protects it from a cleared browser.
  if (spending.bookedCount > 0) {
    out.push({
      id: "backup",
      title: "Save a backup of your plan",
      why: `You've recorded ${spending.bookedCount} booking${spending.bookedCount === 1 ? "" : "s"}. A backup file keeps them safe if this browser is cleared.`,
      button: "Download backup",
      action: { type: "download-backup" },
    });
  }

  return out;
}
