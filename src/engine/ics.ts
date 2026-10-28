import type { TimelineResult } from "./timeline.js";

/**
 * A standard calendar file (RFC 5545) with every open task and the event day.
 * Works with Google Calendar, Apple Calendar and Outlook: reminders without a login.
 */

/** Escapes text for an iCalendar TEXT value. */
export function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line to 75 octets, as the standard requires. */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split a multi-byte character (continuation bytes are 10xxxxxx).
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // following lines start with a space
  }
  return parts.join("\r\n ");
}

const compact = (iso: string) => iso.replace(/-/g, "");
const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export function buildCalendar(
  timeline: TimelineResult,
  opts: { title: string; done: ReadonlySet<string>; stamp: Date },
): string {
  const stamp = opts.stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Toran//every celebration sorted//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(opts.title)}`,
  ];
  const event = (uid: string, date: string, summary: string, description: string) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}@toran.up.railway.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(date)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(date))}`,
      `SUMMARY:${icsText(summary)}`,
      `DESCRIPTION:${icsText(description)}`,
      "TRANSP:TRANSPARENT",
      // Reminder at 6 pm the evening before (all-day events start at midnight).
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(summary)}`,
      "TRIGGER:-PT6H",
      "END:VALARM",
      "END:VEVENT",
    );
  };
  for (const t of timeline.tasks) {
    if (opts.done.has(t.id)) continue;
    event(`${t.id}-${timeline.eventDate}`, t.dueDate, t.title, `${opts.title}: ${t.daysBeforeEvent} days before the event. From your Toran plan.`);
  }
  event(`event-${timeline.eventDate}`, timeline.eventDate, opts.title, "The big day. Every celebration, sorted.");
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
