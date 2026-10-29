/*
 * Toran front end · Sharing: WhatsApp, plan link, PDF, opening a shared plan.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, show } from "./dom.js";
import { fmtDate, inr, subTypeLabel } from "./format.js";
import { api, fresh, replaceState, save, state } from "./store.js";
import { renderKnown } from "./interview.js";
import { renderPlan } from "./plan.js";
import { cleanPhone } from "./vendor-contact.js";
import { MAX_VENDORS, VRANK } from "./vendors.js";

/* ---------- sharing ---------- */
export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const old = button.textContent;
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = old;
      }, 1500);
    }
  } catch {
    window.prompt("Copy this:", text);
  }
}

// The plan link carries the plan inside the part after "#", which browsers
// never send to a server. Opening it rebuilds the plan with the calculator.
export function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
export function planPayload() {
  return {
    v: 1,
    i: state.planInput,
    d: state.deals || {},
    l: state.lineCosts || {},
    t: Object.keys(state.done || {}).filter((k) => state.done[k]),
    // [category, name, phone, status, amount, booked task or "=line", advance]
    vn: (state.vendorList || []).map((v) => [
      v.cat,
      v.name,
      v.phone || "",
      v.status,
      v.agreedINR ?? v.quoteINR ?? 0,
      v.booking ? v.booking.taskId || `=${v.booking.lineKey}` : "",
      v.advanceINR || 0,
    ]),
  };
}
export function planLink() {
  return `${location.origin}/#p=${b64urlEncode(JSON.stringify(planPayload()))}`;
}

export function planSummary() {
  const p = state.plan;
  const k = p.input;
  const sp = p.spending;
  const typeLabel = k.eventType === "wedding" ? `${subTypeLabel(k)} wedding` : subTypeLabel(k);
  const next = p.timeline.tasks
    .filter((t) => !state.done[t.id])
    .slice(0, 3)
    .map((t) => `• ${t.title} (${t.status === "late" ? "overdue" : `by ${fmtDate(t.dueDate)}`})`);
  const lines = [
    `*${typeLabel}* · ${fmtDate(k.eventDate)}${k.city ? ` · ${k.city}` : ""}`,
    `${k.guestCount.toLocaleString("en-IN")} guests · Budget ${inr(k.totalBudgetINR)}`,
  ];
  if (sp.bookedCount)
    lines.push(
      `Booked so far: ${inr(sp.agreedINR)} (advance paid ${inr(sp.advanceINR)})${sp.overBudgetINR ? ` · over budget by ${inr(sp.overBudgetINR)}` : ""}`,
    );
  if (next.length) lines.push("", "*Next up*", ...next);
  lines.push("", `Full plan: ${planLink()}`, "", "Made with Toran · every celebration, sorted.");
  return lines.join("\n");
}

// The privacy note appears when it matters: the moment someone shares the plan.
export const showShareNote = () => {
  $("share-note").hidden = false;
};
$("share-wa").addEventListener("click", () => {
  showShareNote();
  window.open(whatsappUrl(planSummary()), "_blank", "noopener");
});
$("copy-link").addEventListener("click", (e) => {
  showShareNote();
  copyText(planLink(), e.currentTarget);
});
$("save-pdf").addEventListener("click", () => window.print());
// Closed sections don't print, so open them for the PDF and restore afterwards.
export let reopened = [];
window.addEventListener("beforeprint", () => {
  reopened = [...document.querySelectorAll("details:not([open])")];
  reopened.forEach((d) => {
    d.open = true;
  });
});
window.addEventListener("afterprint", () => {
  reopened.forEach((d) => {
    d.open = false;
  });
  reopened = [];
});

/** Opens a plan from a shared link (#p=...). */
export async function importFromLink() {
  const m = /^#p=([A-Za-z0-9_-]{10,16000})$/.exec(location.hash);
  if (!m) return false;
  history.replaceState(null, "", location.pathname); // keep the plan out of the address bar afterwards
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(m[1]));
  } catch {
    return false;
  }
  if (payload?.v !== 1 || !payload.i || typeof payload.i !== "object") return false;
  if (state.plan && JSON.stringify(state.planInput) !== JSON.stringify(payload.i)) {
    if (!confirm("Open the shared plan? It will replace the plan saved on this device.")) return false;
  }
  return openPayload(payload, "This plan link is damaged or out of date, so it couldn't be opened.");
}

/**
 * One tracked vendor from a link or backup row: [category, name, phone, status, amount, booking ref, advance].
 * Anything malformed is dropped; a booking ref is kept only if that booking really exists.
 */
function vendorFromRow(row, i, catKeys, deals, lineCosts) {
  if (!Array.isArray(row)) return null;
  const [cat, name, phone, status, amount, ref, adv] = row;
  if (!catKeys.has(cat) || typeof name !== "string" || !name.trim() || !(status in VRANK)) return null;
  const v = {
    id: `v${Date.now().toString(36)}${i}`,
    cat,
    name: name.trim().slice(0, 60),
    phone: (typeof phone === "string" && cleanPhone(phone)) || "",
    status,
  };
  const confirmed = status === "confirmed";
  if (Number.isInteger(amount) && amount > 0) v[confirmed ? "agreedINR" : "quoteINR"] = amount;
  if (confirmed && typeof ref === "string") v.booking = bookingFromRef(ref, deals, lineCosts);
  if (!v.booking) delete v.booking;
  else if (Number.isInteger(adv) && adv > 0) v.advanceINR = adv;
  return v;
}

/** "=catering" points at a line cost, anything else at a timeline task; only if that booking exists. */
function bookingFromRef(ref, deals, lineCosts) {
  if (ref.startsWith("=")) return lineCosts[ref.slice(1)] ? { lineKey: ref.slice(1) } : undefined;
  return deals[ref] ? { taskId: ref } : undefined;
}

/** Rebuilds a plan from a link or backup file. The server re-validates everything. */
export async function openPayload(payload, failMessage, extra = {}) {
  const pick = (obj) => {
    const out = {};
    if (obj && typeof obj === "object") {
      for (const [id, d] of Object.entries(obj)) {
        if (d && Number.isInteger(d.agreedINR) && Number.isInteger(d.advanceINR))
          out[id] = { agreedINR: d.agreedINR, advanceINR: d.advanceINR };
      }
    }
    return out;
  };
  const deals = pick(payload.d);
  const lineCosts = pick(payload.l);
  try {
    // The server re-validates everything; a tampered link just fails.
    const doneIds = (Array.isArray(payload.t) ? payload.t : []).filter((x) => typeof x === "string" && /^[a-z]-[a-z-]{2,20}$/.test(x));
    const plan = await api("/api/plan", {
      ...payload.i,
      done: doneIds,
      deals: [
        ...Object.entries(deals).map(([taskId, d]) => ({ taskId, ...d })),
        ...Object.entries(lineCosts).map(([lineKey, d]) => ({ lineKey, ...d })),
      ],
    });
    const catKeys = new Set(plan.vendors.map((v) => v.key));
    const vendorList = (Array.isArray(payload.vn) ? payload.vn : [])
      .slice(0, MAX_VENDORS)
      .map((row, i) => vendorFromRow(row, i, catKeys, deals, lineCosts))
      .filter(Boolean);
    replaceState({
      ...fresh(),
      known: { ...payload.i },
      planInput: payload.i,
      plan,
      deals,
      lineCosts,
      vendorList,
      done: Object.fromEntries(doneIds.map((x) => [x, true])),
      ...extra,
    });
    save();
    renderKnown();
    renderPlan();
    show("plan");
    return true;
  } catch {
    alert(failMessage);
    return false;
  }
}
