/*
 * Toran front end · Quote Checker, step 1: read a photo or PDF with AI, then let the user confirm every line.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, el, field } from "./dom.js";
import { waitForAiSlot } from "./store.js";
import { parseRupees } from "./costs.js";
import { runQuoteCheck } from "./quote-verdict.js";
import { lineByKey, quoteDraft } from "./quote.js";

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
  quoteDraft.category = field("quote-category").value;
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
    field("quote-file").value = "";
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
  const line = lineByKey(quoteDraft.category || field("quote-category").value);
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
    f("q-vendor", "Vendor name (as on the quote)", draft.vendorName || quoteDraft.vendor, { maxlength: "80" }),
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
      const get = (k) => /** @type {HTMLInputElement} */ (tr.querySelector(`[data-f="${k}"]`)).value;
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
      const v = parseNum(field(id).value, opt);
      if (v === null) throw new Error(id);
      return v;
    };
    let quote;
    try {
      const min = val("q-min", { int: true });
      const advPct = val("q-advpct"),
        advAmt = val("q-advamt", { int: true });
      quote = {
        category: quoteDraft.category || field("quote-category").value,
        ...(field("q-vendor").value.trim() ? { vendorName: field("q-vendor").value.trim() } : {}),
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
