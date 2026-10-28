/*
 * Toran front end · Quote Checker: read a quotation, confirm, check, compare, book.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, el } from "./dom.js";
import { inr } from "./format.js";
import { api, save, state, waitForAiSlot } from "./store.js";
import { parseRupees, refreshPlan } from "./plan.js";
import { renderNav, showSection } from "./nav.js";
import { bookLine, trackVendorFromQuote } from "./vendors.js";
import { copyText, whatsappUrl } from "./share.js";

/* ---------- Quote Checker ---------- */
// Flow: pick category → photo/PDF (resized on the phone) → AI draft → user confirms
// every line → plain-code checks → verdict, vendor message, save to compare, book.
export let draftCategory = null;
export let prefillVendor = ""; // set when "Check their quote" is pressed on a vendor in the checklist

/** "Check their quote" from the vendor list: opens the Quote Checker for that vendor. */
export function checkVendorQuote(v, c) {
  $("quote-category").value = c.line;
  draftCategory = c.line;
  prefillVendor = v.name;
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
  const sel = $("quote-category");
  const keep = sel.value;
  sel.replaceChildren(...quoteLines().map((l) => el("option", { value: l.key }, `${l.label} (planned ${inr(l.plannedINR)})`)));
  if (keep && lineByKey(keep)) sel.value = keep;
  renderSavedQuotes();
}

/** Re-encodes photos on the phone: smaller upload, and strips hidden data such as GPS location. */
export async function prepareQuoteFile(file) {
  if (file.type === "application/pdf") {
    if (file.size > 8 * 1024 * 1024) throw new Error("That PDF is over 8 MB. Please send a smaller one or a photo.");
    return { blob: file, type: "application/pdf" };
  }
  if (!file.type.startsWith("image/")) throw new Error("Please choose a photo or a PDF.");
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't open this photo. Try a JPG or PNG.");
  }
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("Couldn't prepare this photo.");
  return { blob, type: "image/jpeg" };
}

export async function readQuoteFile(file) {
  const status = $("quote-status");
  $("quote-verdict").replaceChildren();
  $("quote-confirm").replaceChildren();
  draftCategory = $("quote-category").value;
  try {
    status.textContent = "Preparing the photo…";
    const { blob, type } = await prepareQuoteFile(file);
    status.textContent = "Reading your quote… this takes about 15 seconds.";
    await waitForAiSlot();
    const res = await fetch("/api/quote/read", { method: "POST", headers: { "content-type": type }, body: blob });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      status.textContent = data.error || "Couldn't read this quote.";
      if (data.manual) renderConfirm({ lines: [{ description: "" }], gst: { status: "not-mentioned" } }, false);
      return;
    }
    if (!data.readable) {
      status.textContent = "I couldn't find quote lines in that image. Try a clearer, well-lit photo, or type the lines in.";
      renderConfirm({ lines: [{ description: "" }], gst: { status: "not-mentioned" } }, false);
      return;
    }
    status.textContent = `Read ${data.draft.lines.length} line${data.draft.lines.length === 1 ? "" : "s"}${data.dropped ? ` (${data.dropped} unreadable line${data.dropped === 1 ? "" : "s"} left out)` : ""}. Check every number against the paper, then press Check.`;
    renderConfirm(data.draft, true);
  } catch (err) {
    status.textContent = err.message || "Something went wrong. Please try again.";
  } finally {
    $("quote-file").value = "";
  }
}

export const numOrEmpty = (v) => (v === undefined || v === null ? "" : String(v));
export function parseNum(text, { int = false } = {}) {
  const t = String(text).trim();
  if (!t) return undefined;
  const r = parseRupees(t);
  if (r !== null) return r;
  const n = Number(t.replace(/[,\s₹]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return int ? Math.round(n) : n;
}

/** The editable table. Nothing is checked until the user confirms these numbers. */
export function renderConfirm(draft, fromAi) {
  const box = $("quote-confirm");
  const line = lineByKey(draftCategory || $("quote-category").value);
  const rows = el("tbody");
  const addRow = (l = {}) => {
    const tr = el(
      "tr",
      null,
      el(
        "td",
        null,
        el("input", { type: "text", "aria-label": "Item", maxlength: "120", value: l.description || "", "data-f": "description" }),
      ),
      el(
        "td",
        null,
        el("input", {
          type: "text",
          inputmode: "decimal",
          "aria-label": "Quantity",
          value: numOrEmpty(l.quantity),
          "data-f": "quantity",
        }),
      ),
      el("td", null, el("input", { type: "text", "aria-label": "Unit", maxlength: "20", value: l.unit || "", "data-f": "unit" })),
      el(
        "td",
        null,
        el("input", { type: "text", inputmode: "decimal", "aria-label": "Rate", value: numOrEmpty(l.rate), "data-f": "rate" }),
      ),
      el(
        "td",
        null,
        el("input", {
          type: "text",
          inputmode: "decimal",
          "aria-label": "Amount",
          value: numOrEmpty(l.amountINR),
          "data-f": "amountINR",
        }),
      ),
      el("td", null, el("button", { type: "button", class: "icon-x", "aria-label": "Remove this line", onclick: () => tr.remove() }, "×")),
    );
    rows.append(tr);
  };
  (draft.lines.length ? draft.lines : [{}]).forEach(addRow);

  const f = (id, label, value, attrs = {}) =>
    el("div", { class: "field" }, el("label", { for: id }, label), el("input", { id, type: "text", value: numOrEmpty(value), ...attrs }));
  const gstSel = el(
    "select",
    { id: "q-gst" },
    el("option", { value: "included" }, "Included in price"),
    el("option", { value: "extra" }, "Extra, on top"),
    el("option", { value: "not-mentioned" }, "Not mentioned"),
  );
  gstSel.value = draft.gst.status;
  const refund = el("input", { id: "q-refund", type: "checkbox" });
  refund.checked = !!draft.refundMentioned;
  const msg = el("p", { class: "booking-msg", role: "alert" });

  const form = el(
    "form",
    { class: "quote-form" },
    el("p", { class: "booking-title" }, `${fromAi ? "Confirm what Toran read" : "Type the quote"}${line ? ` · ${line.label}` : ""}`),
    fromAi ? el("p", { class: "booking-hint" }, "AI can misread handwriting. Fix anything that doesn't match the paper.") : null,
    f("q-vendor", "Vendor name (as on the quote)", draft.vendorName || prefillVendor, { maxlength: "80" }),
    el(
      "div",
      { class: "table-scroll" },
      el(
        "table",
        { class: "quote-table" },
        el("caption", { class: "sr-only" }, "Quote lines"),
        el(
          "thead",
          null,
          el(
            "tr",
            null,
            ["Item", "Qty", "Unit", "Rate ₹", "Amount ₹", ""].map((h) => el("th", { scope: "col" }, h)),
          ),
        ),
        rows,
      ),
    ),
    el("button", { type: "button", class: "link-btn", onclick: () => addRow() }, "+ Add a line"),
    el(
      "div",
      { class: "quote-fields" },
      f("q-subtotal", "Subtotal ₹", draft.subtotalINR, { inputmode: "decimal" }),
      el("div", { class: "field" }, el("label", { for: "q-gst" }, "GST"), gstSel),
      f("q-gstpct", "GST %", draft.gst.ratePct, { inputmode: "decimal", placeholder: "if written" }),
      f("q-gstamt", "GST amount ₹", draft.gst.amountINR, { inputmode: "decimal" }),
      f("q-total", "Total on quote ₹", draft.totalINR, { inputmode: "decimal" }),
      f("q-min", "Minimum guarantee (plates/guests)", draft.minimumGuarantee?.quantity, {
        inputmode: "numeric",
      }),
      f("q-advpct", "Advance %", draft.advance?.percent, { inputmode: "decimal" }),
      f("q-advamt", "Advance ₹", draft.advance?.amountINR, { inputmode: "decimal" }),
    ),
    el("div", { class: "check-row" }, refund, el("label", { for: "q-refund" }, "Cancellation / refund terms are written on the quote")),
    draft.notes?.length
      ? el(
          "details",
          { class: "quote-notes" },
          el("summary", null, `Terms on the quote (${draft.notes.length})`),
          el(
            "ul",
            null,
            draft.notes.map((n) => el("li", null, n)),
          ),
        )
      : null,
    msg,
    el(
      "div",
      { class: "booking-actions" },
      el("button", { type: "submit", class: "btn-primary" }, "Check this quote"),
      el(
        "button",
        {
          type: "button",
          class: "btn-quiet",
          onclick: () => {
            box.replaceChildren();
            $("quote-status").textContent = "";
          },
        },
        "Cancel",
      ),
    ),
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";
    const lines = [];
    for (const tr of rows.querySelectorAll("tr")) {
      const get = (k) => tr.querySelector(`[data-f="${k}"]`).value;
      const description = get("description").trim();
      const q = parseNum(get("quantity")),
        r = parseNum(get("rate")),
        a = parseNum(get("amountINR"), { int: true });
      if (!description && q === undefined && r === undefined && a === undefined) continue;
      if (!description) {
        msg.textContent = "Every line needs an item name.";
        return;
      }
      if (q === null || r === null || a === null) {
        msg.textContent = `Check the numbers on "${description}".`;
        return;
      }
      lines.push({
        description,
        ...(q !== undefined ? { quantity: q } : {}),
        ...(get("unit").trim() ? { unit: get("unit").trim() } : {}),
        ...(r !== undefined ? { rate: r } : {}),
        ...(a !== undefined ? { amountINR: Math.round(a) } : {}),
      });
    }
    if (!lines.length) {
      msg.textContent = "Add at least one line.";
      return;
    }
    const val = (id, opt) => {
      const v = parseNum($(id).value, opt);
      if (v === null) throw new Error(id);
      return v;
    };
    let quote;
    try {
      const min = val("q-min", { int: true });
      const advPct = val("q-advpct"),
        advAmt = val("q-advamt", { int: true });
      quote = {
        category: draftCategory || $("quote-category").value,
        ...($("q-vendor").value.trim() ? { vendorName: $("q-vendor").value.trim() } : {}),
        lines,
        ...(val("q-subtotal", { int: true }) !== undefined ? { subtotalINR: val("q-subtotal", { int: true }) } : {}),
        gst: {
          status: gstSel.value,
          ...(val("q-gstpct") !== undefined ? { ratePct: val("q-gstpct") } : {}),
          ...(val("q-gstamt", { int: true }) !== undefined ? { amountINR: val("q-gstamt", { int: true }) } : {}),
        },
        ...(val("q-total", { int: true }) !== undefined ? { totalINR: val("q-total", { int: true }) } : {}),
        ...(min !== undefined && min > 0 ? { minimumGuarantee: { quantity: min } } : {}),
        ...(advPct !== undefined || advAmt !== undefined
          ? { advance: { ...(advPct !== undefined ? { percent: advPct } : {}), ...(advAmt !== undefined ? { amountINR: advAmt } : {}) } }
          : {}),
        refundMentioned: refund.checked,
        ...(draft.notes?.length ? { notes: draft.notes.slice(0, 20) } : {}),
      };
    } catch {
      msg.textContent = "One of the amounts isn't a number. Please check the fields below the table.";
      return;
    }
    await runQuoteCheck(quote);
  });

  box.replaceChildren(form);
  form.querySelector("input").focus();
}

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

export function renderSavedQuotes() {
  const box = $("quote-saved");
  const list = state.quotes || [];
  box.replaceChildren();
  if (state.plan) renderNav();
  if (!list.length) return;
  const byCat = {};
  for (const q of list) {
    if (!byCat[q.category]) byCat[q.category] = [];
    byCat[q.category].push(q);
  }
  box.append(el("h3", { class: "saved-title" }, "Saved quotes"));
  for (const [cat, qs] of Object.entries(byCat)) {
    const line = lineByKey(cat);
    const sorted = [...qs].sort((a, b) => a.trueTotalINR - b.trueTotalINR);
    box.append(
      el(
        "div",
        { class: "table-scroll" },
        el(
          "table",
          { class: "compare" },
          el("caption", null, `${line ? line.label : cat}${line ? ` · planned ${inr(line.plannedINR)}` : ""}`),
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
            sorted.map((q, i) =>
              el(
                "tr",
                { class: q.booked ? "booked" : "" },
                el(
                  "th",
                  { scope: "row" },
                  q.vendorName,
                  i === 0 && sorted.length > 1 ? el("span", { class: "badge good" }, "lowest") : null,
                  q.booked ? el("span", { class: "badge booked" }, "booked") : null,
                ),
                el("td", { class: "num" }, inr(q.trueTotalINR)),
                el(
                  "td",
                  null,
                  q.problems ? `${q.problems} mistake${q.problems === 1 ? "" : "s"}` : q.warnings ? `${q.warnings} to ask` : "clean",
                ),
                el(
                  "td",
                  null,
                  el(
                    "button",
                    {
                      type: "button",
                      class: "link-btn",
                      onclick: () => {
                        draftCategory = q.category;
                        runQuoteCheck(q.quote);
                      },
                    },
                    "Open",
                  ),
                  el(
                    "button",
                    {
                      type: "button",
                      class: "link-btn",
                      "aria-label": `Remove ${q.vendorName}`,
                      onclick: () => {
                        state.quotes = state.quotes.filter((x) => x.id !== q.id);
                        save();
                        renderSavedQuotes();
                      },
                    },
                    "Remove",
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

$("quote-file").addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (f) readQuoteFile(f);
});
$("quote-manual").addEventListener("click", () => {
  draftCategory = $("quote-category").value;
  $("quote-verdict").replaceChildren();
  $("quote-status").textContent = "";
  renderConfirm({ lines: [{}], gst: { status: "not-mentioned" } }, false);
});
