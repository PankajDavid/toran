/*
 * Toran front end · Vendor checklist, tracker and Google Maps search.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, el } from "./dom.js";
import { inr } from "./format.js";
import { save, state } from "./store.js";
import { bookLine, unbook } from "./booking.js";
import { parseRupees } from "./costs.js";
import { refreshPlan } from "./plan.js";
import { renderNav } from "./nav.js";
import { cleanPhone, showPhone, vendorIntro, waNumber } from "./vendor-contact.js";
import { findBox } from "./vendor-find.js";
import { checkVendorQuote } from "./quote.js";
import { copyText } from "./share.js";

/* ---------- Vendor checklist & tracker ---------- */
// Per category: the questions to ask, plus the vendors you're talking to and where
// each one stands. Confirming a vendor books their price on the matching budget line.
export const VSTATUS = [
  ["to-contact", "To contact"],
  ["contacted", "Contacted"],
  ["quote", "Quote received"],
  ["shortlisted", "Shortlisted"],
  ["confirmed", "Confirmed"],
  ["not-chosen", "Not chosen"],
];
export const VRANK = { "to-contact": 0, contacted: 1, quote: 2, shortlisted: 3, confirmed: 4, "not-chosen": -1 };
export const MAX_VENDORS = 60;
export const openVendorCats = new Set();

export function renderVendors() {
  const p = state.plan;
  const list = state.vendorList || [];
  const cats = p.vendors;
  const confirmedCats = cats.filter((c) => list.some((v) => v.cat === c.key && v.status === "confirmed")).length;
  const inTalks = list.filter((v) => v.status !== "confirmed" && v.status !== "not-chosen" && cats.some((c) => c.key === v.cat)).length;
  $("vendors-sub").textContent = list.length
    ? `${confirmedCats} of ${cats.length} confirmed · ${inTalks} vendor${inTalks === 1 ? "" : "s"} in talks`
    : "Questions to ask before you pay any advance. Add the vendors you're talking to and track each one.";

  $("vendors").replaceChildren(
    ...cats.map((c) => {
      const mine = list.filter((v) => v.cat === c.key);
      const confirmed = mine.find((v) => v.status === "confirmed");
      const line = c.line ? state.plan.spending.lines.find((l) => l.key === c.line) : null;
      const det = el(
        "details",
        { class: "vendor", open: openVendorCats.has(c.key) },
        el(
          "summary",
          null,
          el("span", { class: "v-cat" }, c.category),
          confirmed
            ? el("span", { class: "badge booked" }, "confirmed")
            : mine.length
              ? el("span", { class: "badge talks" }, `${mine.filter((v) => v.status !== "not-chosen").length} in talks`)
              : null,
          line ? el("span", { class: "v-planned" }, `planned ${inr(line.plannedINR)}`) : null,
        ),
        el("p", { class: "v-label" }, "Ask before paying any advance"),
        el(
          "ul",
          { class: "v-questions" },
          c.questions.map((q) => el("li", null, q)),
        ),
        mine.length
          ? el(
              "ul",
              { class: "v-list", "aria-label": `${c.category} vendors` },
              mine.map((v) => vendorRow(v, c, line)),
            )
          : null,
        findBox(c),
        addVendorForm(c),
      );
      det.addEventListener("toggle", () => {
        if (det.open) openVendorCats.add(c.key);
        else openVendorCats.delete(c.key);
      });
      return det;
    }),
  );
  renderNav();
}

export function vendorRow(v, c, line) {
  const selId = `vs-${v.id}`;
  const sel = el(
    "select",
    { id: selId, class: "v-status" },
    VSTATUS.map(([k, label]) => el("option", { value: k, selected: v.status === k }, label)),
  );
  const li = el(
    "li",
    { class: `v-item s-${v.status}` },
    el(
      "div",
      { class: "v-top" },
      el(
        "div",
        { class: "v-who" },
        el("strong", null, v.name),
        v.phone ? el("span", { class: "v-phone" }, showPhone(v.phone)) : null,
        v.status === "confirmed" && v.agreedINR !== undefined
          ? el("span", { class: "v-note" }, v.agreedINR === null ? "Confirmed" : `Booked for ${inr(v.agreedINR)}`)
          : v.quoteINR
            ? el("span", { class: "v-note" }, `Quote: ${inr(v.quoteINR)}`)
            : null,
      ),
      el("div", { class: "v-state" }, el("label", { class: "sr-only", for: selId }, `Status of ${v.name}`), sel),
    ),
    el(
      "div",
      { class: "row-actions" },
      v.phone ? el("a", { class: "btn-quiet btn-link", href: `tel:${v.phone}` }, "Call") : null,
      v.phone
        ? el(
            "a",
            {
              class: "btn-quiet btn-link",
              href: `https://wa.me/${waNumber(v.phone)}?text=${encodeURIComponent(vendorIntro(v, c))}`,
              target: "_blank",
              rel: "noopener",
            },
            "WhatsApp questions",
          )
        : el(
            "button",
            { type: "button", class: "btn-quiet", onclick: (e) => copyText(vendorIntro(v, c), e.currentTarget) },
            "Copy questions",
          ),
      line ? el("button", { type: "button", class: "btn-quiet", onclick: () => checkVendorQuote(v, c) }, "Check their quote") : null,
      v.status !== "confirmed"
        ? el("button", { type: "button", class: "btn-primary", onclick: () => openConfirmVendor(li, v, c, line) }, "Confirm")
        : null,
      el(
        "button",
        {
          type: "button",
          class: "link-btn",
          "aria-label": `Remove ${v.name}`,
          onclick: () => {
            const wasBooked = v.status === "confirmed" && v.booking;
            if (wasBooked && !confirm(`Remove ${v.name}? Their booking of ${inr(v.agreedINR)} will be removed from your budget.`)) return;
            if (wasBooked) unbook(v);
            state.vendorList = state.vendorList.filter((x) => x.id !== v.id);
            save();
            if (wasBooked) refreshPlan();
            else renderVendors();
          },
        },
        "Remove",
      ),
    ),
  );
  sel.addEventListener("change", () => {
    if (sel.value === "confirmed") {
      sel.value = v.status;
      openConfirmVendor(li, v, c, line);
      return;
    }
    const wasBooked = v.status === "confirmed" && v.booking;
    v.status = sel.value;
    if (wasBooked) {
      unbook(v);
      save();
      refreshPlan();
      return;
    }
    save();
    renderVendors();
  });
  return li;
}

export function addVendorForm(c) {
  const nameId = `vn-${c.key}`,
    phoneId = `vp-${c.key}`;
  const name = el("input", { id: nameId, type: "text", maxlength: "60", autocomplete: "off", placeholder: "e.g. Shubh Rasoi Caterers" });
  const phone = el("input", { id: phoneId, type: "tel", maxlength: "18", autocomplete: "off", placeholder: "optional" });
  const msg = el("p", { class: "booking-msg", role: "alert" });
  const form = el(
    "form",
    { class: "v-add" },
    el("p", { class: "v-label" }, "Or add one you know"),
    el(
      "div",
      { class: "v-add-fields" },
      el("div", { class: "field" }, el("label", { for: nameId }, "Vendor name"), name),
      el("div", { class: "field" }, el("label", { for: phoneId }, "Phone"), phone),
    ),
    msg,
    el("button", { type: "submit", class: "btn-quiet" }, "Add vendor"),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const n = name.value.trim();
    const ph = cleanPhone(phone.value);
    if (!n) {
      msg.textContent = "Enter the vendor's name.";
      name.focus();
      return;
    }
    if (ph === null) {
      msg.textContent = "That phone number doesn't look right. Use digits, like 98765 43210.";
      phone.focus();
      return;
    }
    if (!state.vendorList) state.vendorList = [];
    const list = state.vendorList;
    if (list.length >= MAX_VENDORS) {
      msg.textContent = `You can track up to ${MAX_VENDORS} vendors.`;
      return;
    }
    list.push({ id: `v${Date.now().toString(36)}`, cat: c.key, name: n, phone: ph, status: "contacted" });
    openVendorCats.add(c.key);
    save();
    renderVendors();
    const again = $(nameId);
    if (again) again.focus();
  });
  return form;
}

/** Confirming a vendor records the deal on the timeline task that books their line, so budget and timeline both update. */
export function openConfirmVendor(li, v, c, line) {
  if (li.querySelector(".booking")) return;
  const agreedId = `va-${v.id}`,
    advId = `vadv-${v.id}`;
  const msg = el("p", { class: "booking-msg", role: "alert" });
  const known = v.agreedINR || v.quoteINR;
  const agreed = el("input", {
    id: agreedId,
    type: "text",
    inputmode: "decimal",
    placeholder: "e.g. 2,80,000 or 2.8 lakh",
    value: known ? known.toLocaleString("en-IN") : null,
  });
  const advance = el("input", {
    id: advId,
    type: "text",
    inputmode: "decimal",
    placeholder: "0 if none yet",
    value: v.advanceINR ? v.advanceINR.toLocaleString("en-IN") : null,
  });
  const form = el(
    "form",
    { class: "booking" },
    el(
      "p",
      { class: "booking-title" },
      line ? `Confirm ${v.name}. Planned for ${line.label}: ${inr(line.plannedINR)}.` : `Confirm ${v.name}.`,
    ),
    line ? [el("label", { for: agreedId }, "Final agreed price"), agreed, el("label", { for: advId }, "Advance paid"), advance] : null,
    msg,
    el(
      "div",
      { class: "booking-actions" },
      el("button", { type: "submit", class: "btn-primary" }, "Confirm vendor"),
      el("button", { type: "button", class: "btn-quiet", onclick: () => form.remove() }, "Cancel"),
    ),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!line) {
      v.status = "confirmed";
      v.agreedINR = null;
      delete v.booking;
      save();
      renderVendors();
      return;
    }
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
    bookLine(c.line, { agreedINR: a, advanceINR: adv }, v);
    v.status = "confirmed";
    v.agreedINR = a;
    v.advanceINR = adv;
    save();
    refreshPlan();
  });
  li.append(form);
  (line ? agreed : form.querySelector("button")).focus();
}
