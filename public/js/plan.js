/*
 * Toran front end · The plan screen: budget, timeline, bookings.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, el, show } from "./dom.js";
import { fmtDate, inr, LABELS, pct, subTypeLabel } from "./format.js";
import { api, save, state } from "./store.js";
import { addMsg } from "./interview.js";
import { openBooking, openLineCost } from "./costs.js";
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
  const clone = /** @type {HTMLElement} */ (ready.cloneNode(true));
  ready.replaceWith(clone);
  clone.addEventListener("animationend", (e) => {
    if (e.animationName === "ready-out") clone.hidden = true;
  });
  setTimeout(() => {
    clone.hidden = true;
  }, 4500);
}

/** Title, date and the one-line summary under it. */
function renderHeader(p) {
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
}

/** The six summary tiles once anything is booked: budget, booked, paid, due, still to book, buffer. */
function renderSpendSummary(p) {
  const sp = p.spending;
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
}

/** One budget line: amount, share bar, booking notes and the cost button. */
function budgetRow(l, sp, bpByKey, maxBp) {
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
}

/** The budget table, re-balanced from any bookings the user recorded. */
function renderBudget(p) {
  const sp = p.spending;
  const subParts = [`${inr(p.budget.perGuestINR)} per guest`, `food ${inr(p.budget.foodPerGuestINR)} per guest`];
  $("budget-sub").textContent = subParts.join(" · ");
  renderSpendSummary(p);
  const bpByKey = Object.fromEntries(p.budget.lines.map((l) => [l.key, l.bp]));
  const maxBp = Math.max(...p.budget.lines.map((l) => l.bp));
  $("budget-rows").replaceChildren(...sp.lines.map((l) => budgetRow(l, sp, bpByKey, maxBp)));
  // Total = what the lines above add up to. When bookings push past the budget, say both.
  const projected = sp.projectedSpendINR;
  $("budget-total").replaceChildren(
    inr(projected),
    sp.overBudgetINR ? el("span", { class: "line-note over-note" }, `Budget ${inr(p.budget.totalINR)}`) : "",
  );
}

/** One timeline task. Ticking a booking task asks for the price first; unticking removes its booking. */
function taskItem(t, lineLabel) {
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
}

function renderTimeline(p) {
  const doneCount = p.timeline.tasks.filter((t) => state.done[t.id]).length;
  $("timeline-sub").textContent =
    `${doneCount} of ${p.timeline.tasks.length} done${p.timeline.lateCount ? ` · ${p.timeline.lateCount} behind schedule` : ""}`;
  const lineLabel = Object.fromEntries(p.budget.lines.map((l) => [l.key, l]));
  $("tasks").replaceChildren(...p.timeline.tasks.map((t) => taskItem(t, lineLabel)));
}

/** Draws the whole plan screen from the plan the server calculated. */
export function renderPlan() {
  const p = state.plan;
  if (!p) return;
  renderHeader(p);
  const warnings = $("warnings");
  warnings.replaceChildren(...p.warnings.map((w) => el("p", { class: "warning" }, w.message)));
  renderBudget(p);
  renderTimeline(p);
  renderVendors();
  renderIdeas();
  renderQuoteStart();
  updateInstall();
  renderNav();
  renderSuggestions();
  showSection(state.tab || SECTIONS[0]);
}
