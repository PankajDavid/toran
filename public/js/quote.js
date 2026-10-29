/*
 * Toran front end · Quote Checker: read a quotation, confirm, check, compare, book.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, el, field } from "./dom.js";
import { inr } from "./format.js";
import { save, state } from "./store.js";
import { renderNav, showSection } from "./nav.js";
import { readQuoteFile, renderConfirm } from "./quote-read.js";
import { runQuoteCheck } from "./quote-verdict.js";

/* ---------- Quote Checker ---------- */
// Flow: pick category → photo/PDF (resized on the phone) → AI draft → user confirms
// every line → plain-code checks → verdict, vendor message, save to compare, book.
/**
 * The quote being entered: its budget line, and the vendor name when started from the vendor list.
 * @type {{ category: string | null; vendor: string }}
 */
export const quoteDraft = { category: null, vendor: "" };

/** "Check their quote" from the vendor list: opens the Quote Checker for that vendor. */
export function checkVendorQuote(v, c) {
  field("quote-category").value = c.line;
  quoteDraft.category = c.line;
  quoteDraft.vendor = v.name;
  $("quote-verdict").replaceChildren();
  $("quote-confirm").replaceChildren();
  $("quote-status").textContent = `Checking a quote from ${v.name}. Add a photo or PDF, or type it in.`;
  showSection("quote-card");
  $("quote-card").scrollIntoView({ block: "start" });
  $("quote-file").focus({ preventScroll: true });
}

export function quoteLines() {
  return state.plan ? state.plan.spending.lines.filter((l) => l.key !== "contingency") : [];
}
export function lineByKey(key) {
  return quoteLines().find((l) => l.key === key);
}

export function renderQuoteStart() {
  const sel = field("quote-category");
  const keep = sel.value;
  sel.replaceChildren(...quoteLines().map((l) => el("option", { value: l.key }, `${l.label} (planned ${inr(l.plannedINR)})`)));
  if (keep && lineByKey(keep)) sel.value = keep;
  renderSavedQuotes();
}

const issues = (q) => (q.problems ? `${q.problems} mistake${q.problems === 1 ? "" : "s"}` : q.warnings ? `${q.warnings} to ask` : "clean");

/** One saved quote in the comparison table, with Open and Remove. */
function savedQuoteRow(q, lowest) {
  const open = () => {
    quoteDraft.category = q.category;
    runQuoteCheck(q.quote);
  };
  const remove = () => {
    state.quotes = state.quotes.filter((x) => x.id !== q.id);
    save();
    renderSavedQuotes();
  };
  return el(
    "tr",
    { class: q.booked ? "booked" : "" },
    el(
      "th",
      { scope: "row" },
      q.vendorName,
      lowest ? el("span", { class: "badge good" }, "lowest") : null,
      q.booked ? el("span", { class: "badge booked" }, "booked") : null,
    ),
    el("td", { class: "num" }, inr(q.trueTotalINR)),
    el("td", null, issues(q)),
    el(
      "td",
      null,
      el("button", { type: "button", class: "link-btn", onclick: open }, "Open"),
      el("button", { type: "button", class: "link-btn", "aria-label": `Remove ${q.vendorName}`, onclick: remove }, "Remove"),
    ),
  );
}

/** Saved quotes per category, cheapest true total first, to compare like for like. */
function comparisonTable(cat, qs) {
  const line = lineByKey(cat);
  const sorted = [...qs].sort((a, b) => a.trueTotalINR - b.trueTotalINR);
  return el(
    "div",
    { class: "table-scroll" },
    el(
      "table",
      { class: "compare" },
      el("caption", null, line ? `${line.label} · planned ${inr(line.plannedINR)}` : cat),
      el(
        "thead",
        null,
        el(
          "tr",
          null,
          ["Vendor", "True total", "Issues", ""].map((h) => el("th", { scope: "col" }, h)),
        ),
      ),
      el(
        "tbody",
        null,
        sorted.map((q, i) => savedQuoteRow(q, i === 0 && sorted.length > 1)),
      ),
    ),
  );
}

export function renderSavedQuotes() {
  const box = $("quote-saved");
  const list = state.quotes || [];
  box.replaceChildren();
  if (state.plan) renderNav();
  if (!list.length) return;
  const byCat = groupBy(list, (q) => q.category);
  box.append(el("h3", { class: "saved-title" }, "Saved quotes"), ...Object.entries(byCat).map(([cat, qs]) => comparisonTable(cat, qs)));
}

/** Groups a list into { key: items[] }. */
function groupBy(list, key) {
  const out = {};
  for (const x of list) {
    const k = key(x);
    if (!out[k]) out[k] = [];
    out[k].push(x);
  }
  return out;
}

$("quote-file").addEventListener("change", (e) => {
  const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
  if (f) readQuoteFile(f);
});
$("quote-manual").addEventListener("click", () => {
  quoteDraft.category = field("quote-category").value;
  $("quote-verdict").replaceChildren();
  $("quote-status").textContent = "";
  renderConfirm({ lines: [{}], gst: { status: "not-mentioned" } }, false);
});
