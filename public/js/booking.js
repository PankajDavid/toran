/*
 * Toran front end · Bookings: record a deal on the budget line, never twice for the same vendor.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, el } from "./dom.js";
import { inr } from "./format.js";
import { save, state } from "./store.js";
import { refreshPlan } from "./plan.js";
import { MAX_VENDORS, renderVendors, VRANK } from "./vendors.js";

/** Records the deal: on the timeline task that books this line (so the task ticks too), else as a line cost. */
export const norm = (x) =>
  String(x || "")
    .trim()
    .toLowerCase();
/** The tracked vendor with this name for this budget line, if any. */
export function trackedVendor(lineKey, name) {
  const cat = state.plan?.vendors.find((v) => v.line === lineKey);
  return cat && name ? (state.vendorList || []).find((v) => v.cat === cat.key && norm(v.name) === norm(name)) : undefined;
}
/**
 * What booking this quote would do: update this vendor's own booking, add a new one
 * (a free booking slot exists), or replace an existing booking on the line.
 */
export function bookingPlan(lineKey, name) {
  const mine = trackedVendor(lineKey, name);
  const own = mine && mine.status === "confirmed" && mine.booking ? mine : null;
  const tasks = state.plan.timeline.tasks.filter((t) => t.books === lineKey);
  const ownDeal = own ? (own.booking.taskId ? state.deals[own.booking.taskId] : state.lineCosts[own.booking.lineKey]) : null;
  if (own && ownDeal) return { kind: "update", vendor: own, deal: ownDeal };
  if (tasks.length ? tasks.some((t) => !state.deals[t.id]) : !state.lineCosts[lineKey]) return { kind: "new" };
  const slot = tasks.length ? tasks[0].id : null;
  const deal = slot ? state.deals[slot] : state.lineCosts[lineKey];
  const holder = (state.vendorList || []).find(
    (v) => v.status === "confirmed" && v.booking && (slot ? v.booking.taskId === slot : v.booking.lineKey === lineKey),
  );
  return { kind: "replace", deal, holder };
}

export function bookVendor(quote, r, advanceINR) {
  // Re-booking the same vendor edits their booking; it never adds a second one.
  const booking = bookLine(quote.category, { agreedINR: r.trueTotalINR, advanceINR }, trackedVendor(quote.category, quote.vendorName));
  state.quotes = (state.quotes || []).map((q) =>
    q.category === quote.category
      ? { ...q, booked: q.vendorName === (quote.vendorName || "Vendor") && q.trueTotalINR === r.trueTotalINR }
      : q,
  );
  if (quote.vendorName)
    trackVendorFromQuote(quote.category, quote.vendorName, { status: "confirmed", totalINR: r.trueTotalINR, booking, advanceINR });
  save();
  $("quote-verdict").replaceChildren(
    el(
      "p",
      { class: "verdict-done" },
      `Booked ${quote.vendorName || "the vendor"} for ${inr(r.trueTotalINR)}. Your budget and timeline are updated.`,
    ),
  );
  refreshPlan();
}

/** Adds or updates a tracked vendor after the Quote Checker reads or books their quote. */
/**
 * @param {string} lineKey budget line the quote is for
 * @param {string} name vendor name as on the quote
 * @param {{ status: string; minStatus?: boolean; totalINR?: number; booking?: { taskId?: string; lineKey?: string }; advanceINR?: number }} update
 */
export function trackVendorFromQuote(lineKey, name, { status, minStatus = false, totalINR, booking, advanceINR }) {
  const cat = state.plan?.vendors.find((v) => v.line === lineKey);
  if (!cat) return;
  if (!state.vendorList) state.vendorList = [];
  const list = state.vendorList;
  const norm = (x) => x.trim().toLowerCase();
  let v = list.find((x) => x.cat === cat.key && norm(x.name) === norm(name));
  if (!v) {
    if (list.length >= MAX_VENDORS) return;
    v = { id: `v${Date.now().toString(36)}`, cat: cat.key, name: name.slice(0, 60), phone: "", status: "contacted" };
    list.push(v);
  }
  if (!minStatus || VRANK[v.status] < VRANK[status]) v.status = status;
  if (totalINR) v.quoteINR = totalINR;
  if (booking) {
    for (const o of list)
      if (
        o !== v &&
        o.status === "confirmed" &&
        o.booking &&
        o.booking.taskId === booking.taskId &&
        o.booking.lineKey === booking.lineKey
      ) {
        o.status = "shortlisted";
        if (o.agreedINR) o.quoteINR = o.agreedINR;
        delete o.agreedINR;
        delete o.advanceINR;
        delete o.booking;
      }
    v.booking = booking;
    v.agreedINR = totalINR;
    v.advanceINR = advanceINR;
  }
  save();
  renderVendors();
}

/**
 * Records a deal against a budget line: on a timeline task that books it (so the task ticks),
 * else as a line cost. A vendor already booked on a task keeps that task, so re-confirming edits
 * the same booking instead of adding a second one.
 */
export function bookLine(lineKey, deal, vendor) {
  const tasks = state.plan.timeline.tasks.filter((t) => t.books === lineKey);
  const own = vendor?.booking?.taskId;
  const task = (own && tasks.find((t) => t.id === own)) || tasks.find((t) => !state.deals[t.id]) || tasks[0];
  const booking = task ? { taskId: task.id } : { lineKey };
  // One booking per task: another vendor booked on the same slot steps back to "shortlisted".
  for (const o of state.vendorList || []) {
    if (
      o !== vendor &&
      o.status === "confirmed" &&
      o.booking &&
      o.booking.taskId === booking.taskId &&
      o.booking.lineKey === booking.lineKey
    ) {
      o.status = "shortlisted";
      if (o.agreedINR) o.quoteINR = o.agreedINR;
      delete o.agreedINR;
      delete o.advanceINR;
      delete o.booking;
    }
  }
  if (task) {
    state.deals[task.id] = deal;
    state.done[task.id] = true;
  } else state.lineCosts[lineKey] = deal;
  if (vendor) vendor.booking = booking;
  return booking;
}

/** Undoes a vendor's booking, so the task reopens and the budget line goes back to its estimate. */
export function unbook(v) {
  const b = v.booking;
  if (b?.taskId) {
    delete state.deals[b.taskId];
    delete state.done[b.taskId];
  } else if (b?.lineKey) delete state.lineCosts[b.lineKey];
  delete v.booking;
  delete v.agreedINR;
  delete v.advanceINR;
}
