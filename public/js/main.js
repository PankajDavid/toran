/*
 * Toran front end · Entry point: wires the top-level buttons and restores the saved plan.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, show } from "./dom.js";
import { fresh, replaceState, save, state } from "./store.js";
import { addMsg, renderKnown, renderMsg, turn } from "./interview.js";
import { refreshPlan, renderPlan } from "./plan.js";
import { importFromLink } from "./share.js";

/* ---------- top-level buttons ---------- */
$("start").addEventListener("click", () => {
  show("interview");
  turn({});
});
$("edit-answers").addEventListener("click", () => {
  show("interview");
  renderKnown();
  addMsg("toran", "Tap anything above to change it.");
});
$("restart").addEventListener("click", () => {
  if (!confirm("Start a new plan? This clears the current one from this device.")) return;
  replaceState(fresh());
  save();
  $("chat").replaceChildren();
  renderKnown();
  show("welcome");
});

/* ---------- restore on load ---------- */
for (const m of state.chat) renderMsg(m.who, m.text);
renderKnown();
if (!state.deals) state.deals = {};
if (!state.lineCosts) state.lineCosts = {};
if (!state.quotes) state.quotes = [];
if (state.plan && !state.plan.spending) {
  state.plan = null;
} // plan saved by an older version
function restore() {
  if (state.plan) {
    renderPlan();
    show("plan");
    // Recalculate on every open (no AI): keeps "days to go" and late tasks current,
    // and applies engine fixes and warnings to plans saved by older versions.
    refreshPlan();
  } else if (state.chat.length) {
    show("interview");
    turn({});
  }
}
if (/^#p=/.test(location.hash))
  importFromLink().then((opened) => {
    if (!opened) restore();
  });
else restore();
