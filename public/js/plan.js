/*
 * Toran front end · The plan screen: budget, timeline, bookings.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, el, show } from "./dom.js";
import { fmtDate, inr, LABELS, pct, subTypeLabel } from "./format.js";
import { api, save, state } from "./store.js";
import { addMsg } from "./interview.js";
import { renderNav, SECTIONS, showSection } from "./nav.js";
import { renderIdeas } from "./ideas.js";
import { renderVendors } from "./vendors.js";
import { renderQuoteStart } from "./quote.js";
import { renderSuggestions } from "./suggest.js";
import { updateInstall } from "./install.js";

/* ---------- plan ---------- */
/** Bookings recorded on this device, sent with the plan so code can re-balance the budget. */
export function dealList() {
  return [
    ...Object.entries(state.deals || {}).map(([taskId, d]) => ({ taskId, agreedINR: d.agreedINR, advanceINR: d.advanceINR })),
    ...Object.entries(state.lineCosts || {}).map(([lineKey, d]) => ({ lineKey, agreedINR: d.agreedINR, advanceINR: d.advanceINR })),
  ];
}

export const doneList = () => Object.keys(state.done || {}).filter((k) => state.done[k]);

/** Re-runs the calculator (no AI) after a booking or tick changes. */
export async function refreshPlan() {
  try {
    state.plan = await api("/api/plan", { ...state.planInput, deals: dealList(), done: doneList() });
    save();
  } catch {
    $("warnings").prepend(el("p", { class: "warning" }, "Couldn't update the budget just now. Please try again."));
  }
  renderPlan();
}

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

export async function buildPlan(planInput) {
  try {
    const plan = await api("/api/plan", { ...planInput, deals: dealList(), done: doneList() });
    state.planInput = planInput;
    state.plan = plan;
    state.ideas = null;
    save();
    playReady();
    renderPlan();
    show("plan");
  } catch (err) {
    const issue = err.data?.issues?.[0];
    addMsg(
      "toran",
      issue
        ? `One thing needs fixing: ${issue.message}. Tap it above to change it.`
        : "I couldn't build the plan just now. Please try again.",
    );
  }
}

export function playReady() {
  const ready = $("ready");
  ready.hidden = false;
  // Restart CSS animations each time.
  const clone = ready.cloneNode(true);
  ready.replaceWith(clone);
  clone.addEventListener("animationend", (e) => {
    if (e.animationName === "ready-out") clone.hidden = true;
  });
  setTimeout(() => {
    clone.hidden = true;
  }, 4500);
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
      const aText = f.agreed.value.trim();
      const pText = f.advance.value.trim();
      if (!aText) {
        if (f.kind === "task") {
          msg.textContent = `Enter the agreed price for "${f.label.replace("From the timeline: ", "")}", or untick that task in the timeline to remove it.`;
          f.agreed.focus();
          return;
        }
        updates.push({ f, value: null }); // empty "other costs" = remove it
        continue;
      }
      const a = parseRupees(aText);
      const adv = pText ? parseRupees(pText) : 0;
      if (a === null) {
        msg.textContent = "Enter amounts in rupees, like 60,000 or 1.5 lakh.";
        f.agreed.focus();
        return;
      }
      if (adv === null) {
        msg.textContent = "Enter what's paid in rupees, or leave it empty.";
        f.advance.focus();
        return;
      }
      if (adv > a) {
        msg.textContent = "What's paid can't be more than the amount.";
        f.advance.focus();
        return;
      }
      updates.push({ f, value: { agreedINR: a, advanceINR: adv } });
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

export function renderPlan() {
  const p = state.plan;
  if (!p) return;
  const k = p.input;
  const typeLabel = k.eventType === "wedding" ? `${subTypeLabel(k)} wedding` : subTypeLabel(k);
  $("plan-eyebrow").textContent = LABELS.eventType[k.eventType];
  $("plan-title").textContent = `${typeLabel} · ${fmtDate(k.eventDate)}`;
  const days = p.timeline.daysToGo;
  $("plan-meta").textContent = [
    `${k.guestCount.toLocaleString("en-IN")} guests`,
    inr(k.totalBudgetINR),
    k.city,
    days === 0 ? "today!" : `${days} day${days === 1 ? "" : "s"} to go`,
  ]
    .filter(Boolean)
    .join(" · ");

  const warnings = $("warnings");
  warnings.replaceChildren(...p.warnings.map((w) => el("p", { class: "warning" }, w.message)));

  // Budget (re-balanced from any bookings the user recorded)
  const sp = p.spending;
  const subParts = [`${inr(p.budget.perGuestINR)} per guest`, `food ${inr(p.budget.foodPerGuestINR)} per guest`];
  $("budget-sub").textContent = subParts.join(" · ");
  const summary = $("spend-summary");
  summary.replaceChildren();
  summary.hidden = !sp.bookedCount;
  if (sp.bookedCount) {
    const diff = sp.agreedINR - sp.bookedPlannedINR; // + over estimate, - under
    const tile = (label, value, sub, cls) =>
      el(
        "div",
        { class: cls || "" },
        el("span", { class: "k" }, label),
        el("strong", null, value),
        sub ? el("span", { class: "s" }, sub) : null,
      );
    summary.append(
      tile("Total budget", inr(p.budget.totalINR)),
      tile(
        "Booked",
        inr(sp.agreedINR),
        `estimated ${inr(sp.bookedPlannedINR)}${diff ? ` · ${diff > 0 ? `${inr(diff)} over` : `${inr(-diff)} saved`}` : ""}`,
        diff > 0 ? "warn" : diff < 0 ? "good" : "",
      ),
      tile("Paid so far", inr(sp.advanceINR)),
      tile("Balance due", inr(sp.dueINR), "on bookings made"),
      tile(
        "Still to book",
        inr(sp.unbookedPlannedINR),
        sp.unbookedPlannedINR
          ? sp.lines
              .filter((l) => !l.booked && l.key !== "contingency")
              .map((l) => l.label)
              .join(", ")
          : "everything is booked",
      ),
      sp.overBudgetINR
        ? tile("Over budget", inr(sp.overBudgetINR), "after using the buffer", "over")
        : tile("Buffer left", inr(sp.contingencyNowINR), `planned ${inr(sp.contingencyPlannedINR)}`),
    );
  }
  const bpByKey = Object.fromEntries(p.budget.lines.map((l) => [l.key, l.bp]));
  const maxBp = Math.max(...p.budget.lines.map((l) => l.bp));
  $("budget-rows").replaceChildren(
    ...sp.lines.map((l) => {
      const bar = el("span", { class: "bar", "aria-hidden": "true" });
      bar.style.width = `${Math.max(3, (bpByKey[l.key] / maxBp) * 100)}%`; // biggest line fills the cell
      const isBuffer = l.key === "contingency";
      let note = null;
      if (l.booked) {
        const diff = l.differenceINR;
        note = el(
          "span",
          { class: "line-note" },
          el("span", null, `Planned ${inr(l.plannedINR)}${diff ? ` · ${diff > 0 ? `over by ${inr(diff)}` : `saved ${inr(-diff)}`}` : ""}`),
          el("span", null, `Advance ${inr(l.advanceINR)} · due ${inr(l.dueINR)}`),
        );
      } else if (isBuffer && sp.bookedCount && sp.contingencyNowINR !== l.plannedINR) {
        note = el("span", { class: "line-note" }, `Planned ${inr(l.plannedINR)} · adjusted for your bookings`);
      }
      const amount = l.booked ? l.agreedINR : isBuffer ? sp.contingencyNowINR : l.plannedINR;
      const hasCost = l.booked; // from a timeline booking and/or a recorded cost
      const costBtn = isBuffer
        ? null
        : el(
            "button",
            {
              type: "button",
              class: "link-btn",
              "aria-label": `${hasCost ? "Edit" : "Record"} cost for ${l.label}`,
              onclick: (e) => openLineCost(e.currentTarget.closest("tr"), l),
            },
            hasCost ? "Edit cost" : "Record cost",
          );
      return el(
        "tr",
        { class: l.booked ? "booked" : "" },
        el(
          "th",
          { scope: "row" },
          l.label,
          l.booked ? el("span", { class: "badge booked" }, l.agreedINR === 0 ? "not needed" : "booked") : null,
          note,
          bar,
          costBtn,
        ),
        el("td", { class: "num" }, inr(amount)),
        el("td", { class: "num share" }, pct(bpByKey[l.key])),
      );
    }),
  );
  // Total = what the lines above add up to. When bookings push past the budget, say both.
  const projected = sp.projectedSpendINR;
  $("budget-total").replaceChildren(
    inr(projected),
    sp.overBudgetINR ? el("span", { class: "line-note over-note" }, `Budget ${inr(p.budget.totalINR)}`) : "",
  );

  // Timeline
  const doneCount = p.timeline.tasks.filter((t) => state.done[t.id]).length;
  $("timeline-sub").textContent =
    `${doneCount} of ${p.timeline.tasks.length} done${p.timeline.lateCount ? ` · ${p.timeline.lateCount} behind schedule` : ""}`;
  const lineLabel = Object.fromEntries(p.budget.lines.map((l) => [l.key, l]));
  $("tasks").replaceChildren(
    ...p.timeline.tasks.map((t) => {
      const id = `task-${t.id}`;
      const done = !!state.done[t.id];
      const deal = state.deals[t.id];
      const box = el("input", { type: "checkbox", id });
      box.checked = done;
      const li = el("li", { class: `task${done ? " done" : ""}` });
      box.addEventListener("change", () => {
        if (box.checked && t.books && !deal) {
          box.checked = false; // stays unticked until the booking is saved or skipped
          openBooking(li, t, lineLabel[t.books]);
          return;
        }
        state.done[t.id] = box.checked;
        if (!box.checked && deal) {
          delete state.deals[t.id];
          save();
          refreshPlan();
          return;
        }
        save();
        refreshPlan();
      });
      const when = t.status === "late" ? `Ideally by ${fmtDate(t.idealDate)} · do it now` : `By ${fmtDate(t.dueDate)}`;
      li.append(
        box,
        el(
          "label",
          { for: id },
          t.title,
          !done && t.status !== "upcoming" ? el("span", { class: `badge ${t.status}` }, t.status === "late" ? "late" : "this week") : null,
          el(
            "span",
            { class: "when" },
            deal ? (deal.agreedINR === 0 ? "Not needed" : `Booked for ${inr(deal.agreedINR)} · advance ${inr(deal.advanceINR)}`) : when,
          ),
        ),
      );
      return li;
    }),
  );

  renderVendors();

  renderIdeas();
  renderQuoteStart();
  updateInstall();
  renderNav();
  renderSuggestions();
  showSection(state.tab || SECTIONS[0]);
}
