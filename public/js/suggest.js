/*
 * Toran front end · "Toran suggests": next actions the user approves.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, el } from "./dom.js";
import { save, state } from "./store.js";
import { refreshPlan } from "./plan.js";
import { showSection } from "./nav.js";
import { openVendorCats, renderVendors, vendorIntro, waNumber } from "./vendors.js";
import { backupPlan, backupSignature, calendarSignature, downloadCalendar } from "./files.js";

/* ---------- Toran suggests: approve before anything happens ---------- */
export function vendorSuggestions() {
  if (!state.plan) return [];
  const v = (state.vendorList || []).find((x) => x.status === "to-contact" && x.phone);
  const cat = v && state.plan.vendors.find((c) => c.key === v.cat);
  if (!v || !cat) return [];
  return [
    {
      id: `contact:${v.id}`,
      title: `Send your questions to ${v.name}`,
      why: `Opens WhatsApp with a polite message and the ${cat.questions.length} questions to ask. You check it and press send.`,
      button: "Open WhatsApp",
      action: { type: "whatsapp-vendor", vendorId: v.id },
    },
  ];
}
export function renderSuggestions() {
  const box = $("suggest");
  if (!state.plan) {
    box.hidden = true;
    return;
  }
  const dismissed = state.dismissed || {};
  const sig = (s) => `${s.title}|${s.why}`;
  const all = [...(state.plan.suggestions || []).slice(0, 1), ...vendorSuggestions(), ...(state.plan.suggestions || []).slice(1)]
    .filter((s) => dismissed[s.id] !== sig(s))
    .filter((s) => !(s.id === "calendar" && state.calendarSig === calendarSignature()))
    .filter((s) => !(s.id === "backup" && state.backupSig === backupSignature()))
    .slice(0, 3);
  box.hidden = all.length === 0;
  $("suggest-list").replaceChildren(
    ...all.map((s) =>
      el(
        "li",
        { class: "suggestion" },
        el("div", { class: "sg-text" }, el("strong", null, s.title), el("span", null, s.why)),
        el(
          "div",
          { class: "sg-actions" },
          el("button", { type: "button", class: "btn-primary", onclick: (e) => approve(s, e.currentTarget) }, s.button),
          el(
            "button",
            {
              type: "button",
              class: "btn-quiet",
              "aria-label": `Not now: ${s.title}`,
              onclick: () => {
                state.dismissed = { ...(state.dismissed || {}), [s.id]: sig(s) };
                save();
                renderSuggestions();
              },
            },
            "Not now",
          ),
        ),
      ),
    ),
  );
}
/** Runs an approved suggestion. Every action is one the user could also do by hand. */
export async function approve(s, button) {
  const a = s.action;
  if (a.type === "open-vendors") {
    openVendorCats.add(a.vendor);
    showSection("vendors-card");
    renderVendors();
    const d = [...document.querySelectorAll("details.vendor")].find(
      (x) => /** @type {HTMLDetailsElement} */ (x).open && x.querySelector(".v-cat"),
    );
    const target = document.getElementById(`vc-${a.vendor}`);
    if (target) {
      target.closest("details").scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
    } else if (d) d.scrollIntoView({ block: "start" });
  } else if (a.type === "mark-done") {
    state.done[a.taskId] = true;
    save();
    refreshPlan();
  } else if (a.type === "open-section") {
    showSection(a.section);
    $(a.section).scrollIntoView({ block: "start" });
  } else if (a.type === "download-calendar") {
    await downloadCalendar(button);
  } else if (a.type === "download-backup") {
    backupPlan();
    renderSuggestions();
  } else if (a.type === "whatsapp-vendor") {
    const v = (state.vendorList || []).find((x) => x.id === a.vendorId);
    const cat = v && state.plan.vendors.find((c) => c.key === v.cat);
    if (!v || !cat) return;
    window.open(`https://wa.me/${waNumber(v.phone)}?text=${encodeURIComponent(vendorIntro(v, cat))}`, "_blank", "noopener");
    v.status = "contacted";
    save();
    renderVendors();
    renderSuggestions();
  }
}
