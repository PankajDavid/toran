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

export function renderVerdict(quote, r, savedId) {
  const line = lineByKey(quote.category);
  const box = $("quote-verdict");
  const headline = r.problems
    ? `${r.problems} mistake${r.problems === 1 ? "" : "s"} found`
    : r.warnings
      ? `${r.warnings} thing${r.warnings === 1 ? "" : "s"} to ask`
      : "Looks clean";
  // Is this vendor (or this budget line) already booked? Then say so instead of booking twice.
  const who = quote.vendorName || "this vendor";
  const bp = state.plan ? bookingPlan(quote.category, quote.vendorName) : { kind: "new" };
  let bookTitle = `Decided? Book ${who} for ${inr(r.trueTotalINR)}`;
  let bookNote = "";
  let bookButton = "Book this vendor";
  let alreadyBooked = "";
  if (bp.kind === "update") {
    if (bp.deal.agreedINR === r.trueTotalINR)
      alreadyBooked = `${who} is booked for ${inr(bp.deal.agreedINR)} (advance ${inr(bp.deal.advanceINR)}). It's in your budget.`;
    else {
      bookTitle = `${who} is already booked for ${inr(bp.deal.agreedINR)}`;
      bookNote = `Update the booking to this quote's ${inr(r.trueTotalINR)}? It replaces the old amount, it doesn't add to it.`;
      bookButton = "Update booking";
    }
  } else if (bp.kind === "replace" && bp.deal) {
    bookNote = `You've already booked ${bp.holder ? bp.holder.name : "this"} for ${inr(bp.deal.agreedINR)}. Booking ${who} replaces that booking.`;
    bookButton = "Replace booking";
  }
  const advance = el("input", {
    id: "book-adv",
    type: "text",
    inputmode: "decimal",
    placeholder: "0 if none yet",
    value: bp.kind === "update" && bp.deal.advanceINR ? bp.deal.advanceINR.toLocaleString("en-IN") : null,
  });
  const bookMsg = el("p", { class: "booking-msg", role: "alert" });
  const card = el(
    "section",
    { class: `verdict ${r.problems ? "bad" : r.warnings ? "mid" : "ok"}`, "aria-label": "Quote check result" },
    el(
      "div",
      { class: "verdict-head" },
      el(
        "div",
        null,
        el("p", { class: "eyebrow" }, `${quote.vendorName || "Vendor"} · ${line ? line.label : quote.category}`),
        el("p", { class: "verdict-title" }, headline),
      ),
      el(
        "div",
        { class: "verdict-total" },
        el("span", { class: "k" }, "You'd actually pay"),
        el("strong", null, inr(r.trueTotalINR)),
        r.ifGstExtraINR ? el("span", { class: "s" }, `or ${inr(r.ifGstExtraINR)} if GST is added`) : null,
        r.correctedTotalINR !== null && r.correctedTotalINR !== r.trueTotalINR
          ? el("span", { class: "s fix" }, `${inr(r.correctedTotalINR)} if the mistakes are fixed`)
          : null,
      ),
    ),
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
    ),
    r.message
      ? el(
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
        )
      : null,
    el(
      "div",
      { class: "row-actions" },
      savedId
        ? null
        : el(
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
          ),
    ),
    el(
      "form",
      {
        class: "book-form",
        onsubmit: (e) => {
          e.preventDefault();
          const adv = advance.value.trim() ? parseRupees(advance.value) : 0;
          if (adv === null || adv > r.trueTotalINR) {
            bookMsg.textContent = "Enter the advance in rupees (not more than the total).";
            return;
          }
          bookVendor(quote, r, adv);
        },
      },
      el("p", { class: "booking-title" }, bookTitle),
      bookNote ? el("p", { class: "booking-hint" }, bookNote) : null,
      el("label", { for: "book-adv" }, "Advance paid"),
      advance,
      bookMsg,
      el("button", { type: "submit", class: "btn-primary" }, bookButton),
    ),
  );
  if (alreadyBooked) card.querySelector(".book-form").replaceWith(el("p", { class: "verdict-done" }, alreadyBooked));
  box.replaceChildren(card);
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
