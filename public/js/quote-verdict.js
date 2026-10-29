/*
 * Toran front end · Quote Checker, step 2: run the plain-code checks and show the verdict and vendor message.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, el } from "./dom.js";
import { inr } from "./format.js";
import { api, save, state } from "./store.js";
import { bookingPlan, bookVendor, trackVendorFromQuote } from "./booking.js";
import { parseRupees } from "./costs.js";
import { lineByKey, renderSavedQuotes } from "./quote.js";
import { copyText, whatsappUrl } from "./share.js";

export async function runQuoteCheck(quote) {
  const line = lineByKey(quote.category);
  try {
    const r = await api("/api/quote/check", {
      quote,
      guestCount: state.plan.input.guestCount,
      ...(line ? { plannedINR: line.plannedINR } : {}),
    });
    renderVerdict(quote, r);
    if (quote.vendorName)
      trackVendorFromQuote(quote.category, quote.vendorName, { status: "quote", minStatus: true, totalINR: r.trueTotalINR });
  } catch (err) {
    const issue = err.data?.issues?.[0];
    $("quote-status").textContent = issue ? `Please fix: ${issue.message}` : "Couldn't check this quote. Please try again.";
  }
}

export const SEV = { problem: ["✗", "Problem"], warning: ["!", "Check"], good: ["✓", "Good"] };

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const headline = (r) =>
  r.problems ? `${plural(r.problems, "mistake")} found` : r.warnings ? `${plural(r.warnings, "thing")} to ask` : "Looks clean";

/** Vendor, verdict and what you'd actually pay (and what you'd pay if GST is added, or the maths fixed). */
function verdictHead(quote, r) {
  const line = lineByKey(quote.category);
  const fixed = r.correctedTotalINR !== null && r.correctedTotalINR !== r.trueTotalINR;
  return el(
    "div",
    { class: "verdict-head" },
    el(
      "div",
      null,
      el("p", { class: "eyebrow" }, `${quote.vendorName || "Vendor"} · ${line ? line.label : quote.category}`),
      el("p", { class: "verdict-title" }, headline(r)),
    ),
    el(
      "div",
      { class: "verdict-total" },
      el("span", { class: "k" }, "You'd actually pay"),
      el("strong", null, inr(r.trueTotalINR)),
      r.ifGstExtraINR ? el("span", { class: "s" }, `or ${inr(r.ifGstExtraINR)} if GST is added`) : null,
      fixed ? el("span", { class: "s fix" }, `${inr(r.correctedTotalINR)} if the mistakes are fixed`) : null,
    ),
  );
}

/** Each finding with a symbol for sighted users and a word for screen readers. */
const findingsList = (r) =>
  el(
    "ul",
    { class: "findings" },
    r.findings.map((f) =>
      el(
        "li",
        { class: `finding ${f.severity}` },
        el("span", { class: "sev", "aria-hidden": "true" }, SEV[f.severity][0]),
        el("span", null, el("span", { class: "sr-only" }, `${SEV[f.severity][1]}: `), f.message),
      ),
    ),
  );

/** The polite questions for the vendor, ready for WhatsApp. */
function vendorMessageBox(r) {
  if (!r.message) return null;
  return el(
    "div",
    { class: "vendor-msg" },
    el("p", { class: "booking-title" }, "Questions for the vendor"),
    el("p", { class: "invitation" }, r.message),
    el(
      "div",
      { class: "row-actions" },
      el("a", { class: "btn-primary btn-link", href: whatsappUrl(r.message), target: "_blank", rel: "noopener" }, "Send on WhatsApp"),
      el("button", { type: "button", class: "btn-quiet", onclick: (e) => copyText(r.message, e.currentTarget) }, "Copy"),
    ),
  );
}

function saveButton(quote, r) {
  return el(
    "button",
    {
      type: "button",
      class: "btn-quiet",
      onclick: (e) => {
        saveQuote(quote, r);
        e.currentTarget.textContent = "Saved to compare";
        e.currentTarget.disabled = true;
      },
    },
    "Save to compare",
  );
}

/**
 * The words for the booking box, depending on what's already booked, so a vendor is never booked twice.
 * @returns {{ done?: string; title?: string; note?: string; button?: string; advanceINR?: number }}
 */
export function bookingWords(quote, r) {
  const who = quote.vendorName || "this vendor";
  const bp = state.plan ? bookingPlan(quote.category, quote.vendorName) : { kind: "new" };
  if (bp.kind === "update" && bp.deal.agreedINR === r.trueTotalINR) {
    return { done: `${who} is booked for ${inr(bp.deal.agreedINR)} (advance ${inr(bp.deal.advanceINR)}). It's in your budget.` };
  }
  if (bp.kind === "update") {
    return {
      title: `${who} is already booked for ${inr(bp.deal.agreedINR)}`,
      note: `Update the booking to this quote's ${inr(r.trueTotalINR)}? It replaces the old amount, it doesn't add to it.`,
      button: "Update booking",
      advanceINR: bp.deal.advanceINR,
    };
  }
  const title = `Decided? Book ${who} for ${inr(r.trueTotalINR)}`;
  if (bp.kind === "replace" && bp.deal) {
    const holder = bp.holder ? bp.holder.name : "this";
    return {
      title,
      note: `You've already booked ${holder} for ${inr(bp.deal.agreedINR)}. Booking ${who} replaces that booking.`,
      button: "Replace booking",
    };
  }
  return { title, button: "Book this vendor" };
}

/** Book (or update, or replace) with the advance paid; or a note that it's already booked. */
function bookingBox(quote, r) {
  const words = bookingWords(quote, r);
  if (words.done) return el("p", { class: "verdict-done" }, words.done);
  const advance = el("input", {
    id: "book-adv",
    type: "text",
    inputmode: "decimal",
    placeholder: "0 if none yet",
    value: words.advanceINR ? words.advanceINR.toLocaleString("en-IN") : null,
  });
  const msg = el("p", { class: "booking-msg", role: "alert" });
  const submit = (e) => {
    e.preventDefault();
    const adv = advance.value.trim() ? parseRupees(advance.value) : 0;
    if (adv === null || adv > r.trueTotalINR) {
      msg.textContent = "Enter the advance in rupees (not more than the total).";
      return;
    }
    bookVendor(quote, r, adv);
  };
  return el(
    "form",
    { class: "book-form", onsubmit: submit },
    el("p", { class: "booking-title" }, words.title),
    words.note ? el("p", { class: "booking-hint" }, words.note) : null,
    el("label", { for: "book-adv" }, "Advance paid"),
    advance,
    msg,
    el("button", { type: "submit", class: "btn-primary" }, words.button),
  );
}

/** Shows the result of the checks: verdict, findings, the vendor message, save and book. */
export function renderVerdict(quote, r, savedId) {
  const tone = r.problems ? "bad" : r.warnings ? "mid" : "ok";
  const card = el(
    "section",
    { class: `verdict ${tone}`, "aria-label": "Quote check result" },
    verdictHead(quote, r),
    findingsList(r),
    vendorMessageBox(r),
    el("div", { class: "row-actions" }, savedId ? null : saveButton(quote, r)),
    bookingBox(quote, r),
  );
  $("quote-verdict").replaceChildren(card);
  $("quote-confirm").replaceChildren();
  $("quote-status").textContent = "";
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function saveQuote(quote, r) {
  const id = `q${Date.now().toString(36)}`;
  state.quotes = [
    ...(state.quotes || []),
    {
      id,
      category: quote.category,
      vendorName: quote.vendorName || "Vendor",
      quote,
      trueTotalINR: r.trueTotalINR,
      problems: r.problems,
      warnings: r.warnings,
      savedAt: new Date().toISOString().slice(0, 10),
    },
  ].slice(-30);
  save();
  renderSavedQuotes();
  return id;
}
