/*
 * Toran front end · Sections menu (tabs) and their live status.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $ } from "./dom.js";
import { inr } from "./format.js";
import { save, state } from "./store.js";

/* ---------- sections menu ---------- */
export function setStat(id, text, alert) {
  const n = $(id);
  n.textContent = text;
  n.classList.toggle("alert", !!alert);
}
export function renderNav() {
  const p = state.plan;
  const sp = p.spending;
  setStat("nav-budget", sp.bookedCount ? `${inr(sp.agreedINR)} booked` : inr(p.input.totalBudgetINR), sp.overBudgetINR > 0);
  const open = p.timeline.tasks.filter((t) => !state.done[t.id]);
  const late = open.filter((t) => t.status === "late").length;
  setStat("nav-timeline", late ? `${late} late` : open.length ? `${open.length} to do` : "all done", late > 0);
  const list = state.vendorList || [];
  const confirmed = p.vendors.filter((c) => list.some((v) => v.cat === c.key && v.status === "confirmed")).length;
  setStat("nav-vendors", `${confirmed}/${p.vendors.length} confirmed`);
  const q = (state.quotes || []).length;
  setStat("nav-quotes", q ? `${q} saved` : "check a quote");
  setStat("nav-ideas", state.ideas ? "ready" : "get ideas");
  setStat("nav-invitation", state.ideas?.ideas.invitation ? "ready" : "write one");
  setStat("nav-tips", state.ideas?.ideas.tips.length ? `${state.ideas.ideas.tips.length} tips` : "get tips");
}

/* One section at a time: the menu works as tabs (arrow keys move between them). */
export const tabs = [...document.querySelectorAll('#plan-tabs [role="tab"]')];
export const SECTIONS = tabs.map((t) => t.dataset.sec);
export function showSection(sec, { focus = false } = {}) {
  if (!SECTIONS.includes(sec)) sec = SECTIONS[0];
  if (state.tab !== sec) {
    state.tab = sec;
    save();
  }
  for (const t of tabs) {
    const on = t.dataset.sec === sec;
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1;
    $(t.dataset.sec).hidden = !on;
  }
  const tab = tabs.find((t) => t.dataset.sec === sec);
  if (focus && tab) tab.focus();
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => {
    showSection(t.dataset.sec);
    // On phones, bring the chosen section's top into view under the sticky strip.
    if (innerWidth < 1100 && $("plan-nav").getBoundingClientRect().top < 60) $(t.dataset.sec).scrollIntoView({ block: "start" });
  });
  t.addEventListener("keydown", (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let n = null;
    if (e.key in keys) n = (i + keys[e.key] + tabs.length) % tabs.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = tabs.length - 1;
    if (n === null) return;
    e.preventDefault();
    showSection(tabs[n].dataset.sec, { focus: true });
  });
});
