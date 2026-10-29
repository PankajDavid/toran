/*
 * Toran front end · Vendor phone numbers and the WhatsApp message with the questions to ask.
 * Every piece of text is inserted with textContent (never innerHTML).
 */

import { fmtDate, subTypeLabel } from "./format.js";
import { state } from "./store.js";

/** Accepts Indian numbers like 98765 43210, +91-98765-43210 or 0172 2700000; returns digits or null. */
export function cleanPhone(text) {
  const d = String(text || "").replace(/[\s().-]/g, "");
  if (!d) return "";
  if (!/^\+?\d{6,13}$/.test(d)) return null;
  const digits = d.replace(/^\+/, "");
  if (/^91\d{10}$/.test(digits)) return digits.slice(2); // +91 98765 43210 → 9876543210
  if (/^0\d{10}$/.test(digits) && /^0[6-9]/.test(digits)) return digits.slice(1); // 09876543210
  return digits;
}
/** wa.me needs the country code; a 10-digit Indian mobile gets 91. */
export const waNumber = (digits) => (digits.length === 10 ? `91${digits}` : /^0\d{10}$/.test(digits) ? `91${digits.slice(1)}` : digits);
export const showPhone = (digits) => (digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits);

export function vendorIntro(v, cat) {
  const k = state.plan.input;
  const typeLabel = k.eventType === "wedding" ? `${subTypeLabel(k)} wedding` : subTypeLabel(k).toLowerCase();
  const qs = cat.questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  return `Namaste ${v.name.replace(/\s+ji$/i, "")} ji,\nWe're planning a ${typeLabel} on ${fmtDate(k.eventDate)}${k.city ? ` in ${k.city}` : ""} for about ${k.guestCount.toLocaleString("en-IN")} guests.\nWe're looking for: ${cat.category}\n\nCould you please share your rates and answer these:\n${qs}\n\nThank you!`;
}
