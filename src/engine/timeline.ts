import type { EventType } from "./config.js";
import { daysBetween, fromDayNumber, toDayNumber } from "./dates.js";
import type { PlanWarning } from "./budget.js";

interface TaskTemplate {
  id: string;
  title: string;
  /** Ideal number of days before the event. */
  leadDays: number;
  /** If set, the task only applies when one of these sub-types / sub-events is chosen. */
  onlyFor?: string[];
}

export interface TimelineTask {
  id: string;
  title: string;
  dueDate: string;
  idealDate: string;
  daysBeforeEvent: number;
  status: "late" | "due-soon" | "upcoming";
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

const TEMPLATES: Record<EventType, TaskTemplate[]> = {
  wedding: [
    { id: "w-budget", title: "Agree total budget and draft guest list with both families", leadDays: 180 },
    { id: "w-venue", title: "Book venue(s)", leadDays: 150 },
    { id: "w-caterer", title: "Shortlist caterers, do tastings, book one", leadDays: 120 },
    { id: "w-photo", title: "Book photographer and videographer", leadDays: 120 },
    { id: "w-decor", title: "Book decorator and finalise theme", leadDays: 90 },
    { id: "w-outfits", title: "Order wedding outfits (allow alteration time)", leadDays: 90 },
    { id: "w-save-date", title: "Send save-the-dates to outstation guests", leadDays: 75 },
    { id: "w-stay", title: "Block rooms and plan transport for outstation guests", leadDays: 60 },
    { id: "w-makeup", title: "Book makeup artist", leadDays: 60 },
    { id: "w-dj", title: "Book DJ / dhol / band for sangeet", leadDays: 60, onlyFor: ["sangeet"] },
    { id: "w-mehendi", title: "Book mehendi artist", leadDays: 45, onlyFor: ["mehendi"] },
    { id: "w-invites", title: "Print and send invitations", leadDays: 45 },
    { id: "w-choreo", title: "Start sangeet choreography rehearsals", leadDays: 30, onlyFor: ["sangeet"] },
    { id: "w-rsvp", title: "Chase RSVPs and confirm final guest count", leadDays: 14 },
    { id: "w-haldi", title: "Arrange haldi supplies and outfits", leadDays: 7, onlyFor: ["haldi"] },
    { id: "w-headcount", title: "Give final headcount to caterer", leadDays: 7 },
    { id: "w-payments", title: "Prepare vendor payment schedule and contact sheet", leadDays: 5 },
    { id: "w-kit", title: "Pack emergency kit (safety pins, meds, chargers, cash)", leadDays: 2 },
    { id: "w-brief", title: "Brief the day-of coordinator and family point people", leadDays: 1 },
  ],
  birthday: [
    { id: "b-venue", title: "Book venue or confirm home setup", leadDays: 30 },
    { id: "b-invites", title: "Send invitations", leadDays: 21 },
    { id: "b-ent", title: "Book entertainer / games / music", leadDays: 21 },
    { id: "b-decor", title: "Plan theme and order decor", leadDays: 14 },
    { id: "b-cake", title: "Order cake", leadDays: 10 },
    { id: "b-gifts", title: "Buy return gifts", leadDays: 10, onlyFor: ["kid"] },
    { id: "b-rsvp", title: "Confirm RSVPs", leadDays: 5 },
    { id: "b-headcount", title: "Give final headcount for food", leadDays: 3 },
    { id: "b-day", title: "Day-before checklist: candles, lighter, plates, music", leadDays: 1 },
  ],
  community: [
    { id: "c-permits", title: "Get permissions (RWA / police / municipal) as needed", leadDays: 45 },
    { id: "c-venue", title: "Book ground / tent and seating", leadDays: 40 },
    { id: "c-sound", title: "Book sound and lighting", leadDays: 30 },
    { id: "c-mandali", title: "Book bhajan mandali", leadDays: 30, onlyFor: ["jagran"] },
    { id: "c-performers", title: "Line up performers and games", leadDays: 30, onlyFor: ["diwali-mela", "rwa-function", "other"] },
    { id: "c-stalls", title: "Allot stalls and collect stall fees", leadDays: 21, onlyFor: ["diwali-mela"] },
    { id: "c-volunteers", title: "Form volunteer teams and assign leads", leadDays: 21 },
    { id: "c-promo", title: "Announce on society groups and notice boards", leadDays: 21 },
    { id: "c-ration", title: "Order ration and confirm cooking volunteers", leadDays: 10, onlyFor: ["langar"] },
    { id: "c-food", title: "Confirm food arrangements and quantities", leadDays: 14, onlyFor: ["jagran", "diwali-mela", "rwa-function", "other"] },
    { id: "c-safety", title: "Arrange first aid, fire safety and crowd plan", leadDays: 7 },
    { id: "c-cleanup", title: "Plan cleanup and waste segregation", leadDays: 3 },
    { id: "c-brief", title: "Brief all volunteer leads", leadDays: 1 },
  ],
};

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
): TimelineResult {
  const daysToGo = daysBetween(today, eventDate);
  if (daysToGo < 0) throw new RangeError("Event date is in the past");

  const eventDay = toDayNumber(eventDate);
  const todayDay = toDayNumber(today);

  const tasks: TimelineTask[] = TEMPLATES[eventType]
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
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.daysBeforeEvent - a.daysBeforeEvent);

  const lateCount = tasks.filter((t) => t.status === "late").length;
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
