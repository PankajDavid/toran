import type { EventType } from "./config.js";
import { daysBetween, fromDayNumber, toDayNumber } from "./dates.js";
import type { PlanWarning } from "./budget.js";
import { TASK_TEMPLATES } from "./data/timeline-tasks.js";

export interface TimelineTask {
  id: string;
  title: string;
  dueDate: string;
  idealDate: string;
  daysBeforeEvent: number;
  status: "late" | "due-soon" | "upcoming";
  /** Budget category key this task books, if any (set when the category exists in the plan). */
  books?: string;
}

export interface TimelineResult {
  eventDate: string;
  today: string;
  daysToGo: number;
  compressed: boolean;
  lateCount: number;
  tasks: TimelineTask[];
  warnings: PlanWarning[];
}

const SOON_DAYS = 7;

/**
 * Schedules tasks backwards from the event date. Tasks whose ideal date has
 * already passed are moved to today and marked late, so the plan "compresses"
 * instead of showing impossible past deadlines.
 */
export function buildTimeline(
  eventType: EventType,
  eventDate: string,
  today: string,
  selectors: readonly string[] = [],
  /** Ids of tasks the user has ticked. Done tasks are never counted as late. */
  done: ReadonlySet<string> = new Set(),
): TimelineResult {
  const daysToGo = daysBetween(today, eventDate);
  if (daysToGo < 0) throw new RangeError("Event date is in the past");

  const eventDay = toDayNumber(eventDate);
  const todayDay = toDayNumber(today);

  const tasks: TimelineTask[] = TASK_TEMPLATES[eventType]
    .filter((t) => !t.onlyFor || t.onlyFor.some((s) => selectors.includes(s)))
    .map((t) => {
      const idealDay = eventDay - t.leadDays;
      const late = idealDay < todayDay;
      const dueDay = late ? todayDay : idealDay;
      const status: TimelineTask["status"] = late ? "late" : dueDay - todayDay <= SOON_DAYS ? "due-soon" : "upcoming";
      return {
        id: t.id,
        title: t.title,
        dueDate: fromDayNumber(dueDay),
        idealDate: fromDayNumber(idealDay),
        daysBeforeEvent: eventDay - dueDay,
        status,
        ...(t.books ? { books: t.books } : {}),
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.daysBeforeEvent - a.daysBeforeEvent);

  const lateCount = tasks.filter((t) => t.status === "late" && !done.has(t.id)).length;
  const warnings: PlanWarning[] = [];
  if (lateCount > 0) {
    warnings.push({
      code: "TIMELINE_COMPRESSED",
      severity: "warning",
      message: `${lateCount} task${lateCount === 1 ? " is" : "s are"} past the ideal date and moved to today. Prioritise venue and food bookings first.`,
    });
  }

  return { eventDate, today, daysToGo, compressed: lateCount > 0, lateCount, tasks, warnings };
}
