/*
 * Toran front end · Recording real costs: the booking form under a task and the cost editor on a budget line.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { el } from "./dom.js";
import { inr } from "./format.js";
import { save, state } from "./store.js";
import { refreshPlan } from "./plan.js";

/** Reads "2,80,000", "280000", "2.8 lakh", "2.8L" or "75k" as whole rupees. */
export function parseRupees(text) {
  const t = String(text)
    .toLowerCase()
    .replace(/[₹,\s]|rs\.?/g, "");
  const m = /^(\d+(?:\.\d+)?)(crore|cr|lakh|lakhs|lac|l|k)?$/.exec(t);
  if (!m) return null;
  const mult = { crore: 1e7, cr: 1e7, lakh: 1e5, lakhs: 1e5, lac: 1e5, l: 1e5, k: 1e3 }[m[2]] || 1;
  const n = Math.round(Number(m[1]) * mult);
  return Number.isFinite(n) && n >= 0 && n <= 5e7 ? n : null;
}

/**
 * One cost entry from the editor. An empty "other costs" entry means remove it; an empty
 * timeline booking must be unticked in the timeline instead.
 * @returns {{ value: { agreedINR: number; advanceINR: number } | null } | { error: string; focus: HTMLElement }}
 */
function readCostEntry(f) {
  const aText = f.agreed.value.trim();
  const pText = f.advance.value.trim();
  if (!aText && f.kind === "task") {
    const task = f.label.replace("From the timeline: ", "");
    return { error: `Enter the agreed price for "${task}", or untick that task in the timeline to remove it.`, focus: f.agreed };
  }
  if (!aText) return { value: null };
  const agreed = parseRupees(aText);
  const advance = pText ? parseRupees(pText) : 0;
  if (agreed === null) return { error: "Enter amounts in rupees, like 60,000 or 1.5 lakh.", focus: f.agreed };
  if (advance === null) return { error: "Enter what's paid in rupees, or leave it empty.", focus: f.advance };
  if (advance > agreed) return { error: "What's paid can't be more than the amount.", focus: f.advance };
  return { value: { agreedINR: agreed, advanceINR: advance } };
}

/**
 * Inline form under a budget line. It shows EVERY cost already recorded on this
 * line, each editable in place, so editing never adds a second copy:
 *  - one row per timeline booking that books this line, and
 *  - one "other costs" row for anything no task covers (optional).
 */
export function openLineCost(tr, line) {
  const next = tr.nextElementSibling;
  if (next?.classList.contains("cost-row")) {
    next.remove();
    return;
  }
  const tasks = state.plan.timeline.tasks.filter((t) => t.books === line.key && state.deals[t.id]);
  const own = state.lineCosts[line.key];
  const msg = el("p", { class: "booking-msg", role: "alert" });
  const entries = []; // { kind, id, label, agreed, advance }

  function entry(kind, id, label, hint, current) {
    const aId = `cost-a-${kind}-${id}`,
      pId = `cost-p-${kind}-${id}`;
    const agreed = el("input", {
      id: aId,
      type: "text",
      inputmode: "decimal",
      placeholder: kind === "line" ? "Leave empty if none" : "e.g. 60,000",
    });
    const advance = el("input", { id: pId, type: "text", inputmode: "decimal", placeholder: "0 if none yet" });
    if (current) {
      agreed.value = String(current.agreedINR);
      advance.value = String(current.advanceINR);
    }
    entries.push({ kind, id, label, agreed, advance });
    return el(
      "fieldset",
      { class: "cost-entry" },
      el("legend", null, label),
      hint ? el("p", { class: "booking-hint" }, hint) : null,
      el(
        "div",
        { class: "cost-pair" },
        el("div", null, el("label", { for: aId }, "Agreed or spent"), agreed),
        el("div", null, el("label", { for: pId }, "Paid so far"), advance),
      ),
    );
  }

  const fields = [
    ...tasks.map((t) => entry("task", t.id, `From the timeline: ${t.title}`, null, state.deals[t.id])),
    entry(
      "line",
      line.key,
      tasks.length ? "Other costs for this line" : line.label,
      tasks.length ? "Only costs the timeline booking above doesn't already include." : null,
      own,
    ),
  ];

  const form = el(
    "form",
    { class: "booking" },
    el("p", { class: "booking-title" }, `${line.label}: planned ${inr(line.plannedINR)}`),
    ...fields,
    msg,
    el(
      "div",
      { class: "booking-actions" },
      el("button", { type: "submit", class: "btn-primary" }, "Save"),
      tasks.length
        ? null
        : el(
            "button",
            {
              type: "button",
              class: "btn-quiet",
              onclick: () => {
                state.lineCosts[line.key] = { agreedINR: 0, advanceINR: 0 };
                save();
                refreshPlan();
              },
            },
            "Not needed (₹0)",
          ),
      el("button", { type: "button", class: "btn-quiet", onclick: () => row.remove() }, "Cancel"),
    ),
  );

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const updates = [];
    for (const f of entries) {
      const read = readCostEntry(f);
      if ("error" in read) {
        msg.textContent = read.error;
        read.focus.focus();
        return;
      }
      updates.push({ f, value: read.value });
    }
    for (const { f, value } of updates) {
      if (f.kind === "task") state.deals[f.id] = value;
      else if (value)
        state.lineCosts[f.id] = value; // ₹0 = "not needed", kept on purpose
      else delete state.lineCosts[f.id];
    }
    save();
    refreshPlan();
  });
  const row = el("tr", { class: "cost-row" }, el("td", { colspan: "3" }, form));
  tr.after(row);
  entries[0].agreed.focus();
}

/** Inline "deal closed" form under a booking task. */
export function openBooking(li, task, line) {
  if (li.querySelector(".booking")) return;
  const agreedId = `agreed-${task.id}`,
    advId = `adv-${task.id}`;
  const msg = el("p", { class: "booking-msg", role: "alert" });
  const agreed = el("input", {
    id: agreedId,
    type: "text",
    inputmode: "decimal",
    placeholder: "e.g. 2,80,000 or 2.8 lakh",
    required: true,
  });
  const advance = el("input", { id: advId, type: "text", inputmode: "decimal", placeholder: "0 if none yet" });
  const form = el(
    "form",
    { class: "booking" },
    el("p", { class: "booking-title" }, `Booked! ${line ? `Planned for ${line.label}: ${inr(line.amountINR)}.` : ""}`),
    el("label", { for: agreedId }, "Final agreed price"),
    agreed,
    el("label", { for: advId }, "Advance paid"),
    advance,
    msg,
    el(
      "div",
      { class: "booking-actions" },
      el("button", { type: "submit", class: "btn-primary" }, "Save booking"),
      el(
        "button",
        {
          type: "button",
          class: "btn-quiet",
          onclick: () => {
            state.deals[task.id] = { agreedINR: 0, advanceINR: 0 };
            state.done[task.id] = true;
            save();
            refreshPlan();
          },
        },
        "Not needed (₹0)",
      ),
      el(
        "button",
        {
          type: "button",
          class: "btn-quiet",
          onclick: () => {
            state.done[task.id] = true;
            save();
            refreshPlan();
          },
        },
        "Done, cost later",
      ),
      el("button", { type: "button", class: "btn-quiet", onclick: () => form.remove() }, "Cancel"),
    ),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const a = parseRupees(agreed.value);
    const adv = advance.value.trim() ? parseRupees(advance.value) : 0;
    if (a === null) {
      msg.textContent = "Enter the agreed price in rupees, like 2,80,000 or 2.8 lakh.";
      agreed.focus();
      return;
    }
    if (adv === null) {
      msg.textContent = "Enter the advance in rupees, or leave it empty.";
      advance.focus();
      return;
    }
    if (adv > a) {
      msg.textContent = "The advance can't be more than the agreed price.";
      advance.focus();
      return;
    }
    state.deals[task.id] = { agreedINR: a, advanceINR: adv };
    state.done[task.id] = true;
    save();
    refreshPlan();
  });
  li.append(form);
  agreed.focus();
}
