/*
 * Toran front end · Vendor checklist, tracker and Google Maps search.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, el } from "./dom.js";
import { fmtDate, inr, subTypeLabel } from "./format.js";
import { api, MIN_GAP_MS, save, state } from "./store.js";
import { parseRupees, refreshPlan } from "./plan.js";
import { renderNav } from "./nav.js";
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

/** Accepts Indian numbers like 98765 43210, +91-98765-43210 or 0172 2700000; returns digits or null. */
export function cleanPhone(text) {
  const d = String(text || "").replace(/[\s().-]/g, "");
  if (!d) return "";
  if (!/^\+?\d{6,13}$/.test(d)) return null;
  const digits = d.replace(/^\+/, "");
  if (/^91\d{10}$/.test(digits)) return digits.slice(2); // +91 98765 43210 → 9876543210
  if (/^0\d{10}$/.test(digits) && /^0[6-9]/.test(digits)) return digits.slice(1); // 09876543210
  return digits;
}
/** wa.me needs the country code; a 10-digit Indian mobile gets 91. */
export const waNumber = (digits) => (digits.length === 10 ? `91${digits}` : /^0\d{10}$/.test(digits) ? `91${digits.slice(1)}` : digits);
export const showPhone = (digits) => (digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits);

export function vendorIntro(v, cat) {
  const k = state.plan.input;
  const typeLabel = k.eventType === "wedding" ? `${subTypeLabel(k)} wedding` : subTypeLabel(k).toLowerCase();
  const qs = cat.questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  return `Namaste ${v.name.replace(/\s+ji$/i, "")} ji,\nWe're planning a ${typeLabel} on ${fmtDate(k.eventDate)}${k.city ? ` in ${k.city}` : ""} for about ${k.guestCount.toLocaleString("en-IN")} guests.\nWe're looking for: ${cat.category}\n\nCould you please share your rates and answer these:\n${qs}\n\nThank you!`;
}

/** Adds or updates a tracked vendor after the Quote Checker reads or books their quote. */
export function trackVendorFromQuote(lineKey, name, { status, minStatus = false, totalINR, booking, advanceINR }) {
  const cat = state.plan?.vendors.find((v) => v.line === lineKey);
  if (!cat) return;
  if (!state.vendorList) state.vendorList = [];
  const list = state.vendorList;
  const norm = (x) => x.trim().toLowerCase();
  let v = list.find((x) => x.cat === cat.key && norm(x.name) === norm(name));
  if (!v) {
    if (list.length >= MAX_VENDORS) return;
    v = { id: `v${Date.now().toString(36)}`, cat: cat.key, name: name.slice(0, 60), phone: "", status: "contacted" };
    list.push(v);
  }
  if (!minStatus || VRANK[v.status] < VRANK[status]) v.status = status;
  if (totalINR) v.quoteINR = totalINR;
  if (booking) {
    for (const o of list)
      if (
        o !== v &&
        o.status === "confirmed" &&
        o.booking &&
        o.booking.taskId === booking.taskId &&
        o.booking.lineKey === booking.lineKey
      ) {
        o.status = "shortlisted";
        if (o.agreedINR) o.quoteINR = o.agreedINR;
        delete o.agreedINR;
        delete o.advanceINR;
        delete o.booking;
      }
    v.booking = booking;
    v.agreedINR = totalINR;
    v.advanceINR = advanceINR;
  }
  save();
  renderVendors();
}

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

/* Find vendors near you: real Google Maps listings, kept in memory only (not saved). */
export const found = new Map(); // category key -> { where, vendors } | { error }
export const priceOpen = new Set(); // categories showing "check prices online" links
export let lastFind = 0;
export let searchCity = ""; // the city last searched, so the box keeps showing it after results appear

export function findBox(c) {
  const k = state.plan.input;
  const box = el("div", { class: "v-find" });
  const res = found.get(c.key);
  const cityId = `vc-${c.key}`;
  const cityInput = el("input", {
    id: cityId,
    type: "text",
    maxlength: "60",
    autocomplete: "address-level2",
    placeholder: "e.g. Panchkula",
    value: searchCity || k.city || null,
  });
  const status = el("p", { class: "v-find-status", role: "status" });
  const run = async (body, where) => {
    const now = Date.now();
    if (now - lastFind < MIN_GAP_MS) return;
    lastFind = now;
    status.textContent = "Searching Google Maps…";
    try {
      const r = await api("/api/vendors/find", { category: c.key, ...body });
      found.set(c.key, { where, vendors: r.vendors });
    } catch (err) {
      found.set(c.key, { error: err.data?.error || "Couldn't search just now. Please try again." });
    }
    openVendorCats.add(c.key);
    renderVendors();
  };
  box.append(
    el("p", { class: "v-label" }, "Find on Google Maps"),
    el(
      "form",
      {
        class: "v-find-form",
        onsubmit: (e) => {
          e.preventDefault();
          const city = cityInput.value.trim();
          if (!/^[\p{L} .'-]{2,60}$/u.test(city)) {
            status.textContent = "Enter a city name, like Panchkula.";
            cityInput.focus();
            return;
          }
          searchCity = city;
          run({ city }, city);
        },
      },
      el("label", { class: "sr-only", for: cityId }, "City to search in"),
      cityInput,
      el("button", { type: "submit", class: "btn-quiet" }, "Search"),
      el(
        "button",
        {
          type: "button",
          class: "btn-quiet",
          "aria-expanded": priceOpen.has(c.key) ? "true" : "false",
          onclick: () => {
            if (priceOpen.has(c.key)) priceOpen.delete(c.key);
            else priceOpen.add(c.key);
            openVendorCats.add(c.key);
            renderVendors();
          },
        },
        "Check prices online",
      ),
      "geolocation" in navigator
        ? el(
            "button",
            {
              type: "button",
              class: "btn-quiet",
              onclick: () => {
                status.textContent = "Getting your location…";
                navigator.geolocation.getCurrentPosition(
                  // Rounded on this phone to about 1 km before it leaves; used once and never saved.
                  (pos) =>
                    run(
                      { near: { lat: Math.round(pos.coords.latitude * 100) / 100, lng: Math.round(pos.coords.longitude * 100) / 100 } },
                      "near you",
                    ),
                  () => {
                    status.textContent = "Location isn't available. Type your city instead.";
                  },
                  { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
                );
              },
            },
            "Near me",
          )
        : null,
    ),
    status,
  );
  if (priceOpen.has(c.key)) box.append(priceLinks(c, cityInput.value.trim() || k.city || ""));
  if (res?.error) status.textContent = res.error;
  else if (res) {
    const mine = new Set((state.vendorList || []).filter((v) => v.cat === c.key).map((v) => v.name.trim().toLowerCase()));
    box.append(
      res.vendors.length
        ? el(
            "p",
            { class: "v-label" },
            res.where === "near you" ? "Google Maps results near your location" : `Google Maps results in ${res.where}`,
          )
        : null,
      res.vendors.length
        ? el(
            "p",
            { class: "fineprint-left v-vouch" },
            "Listings and ratings from Google Maps. Toran doesn't vouch for any vendor: check reviews, visit, and get a written quote.",
          )
        : null,
      res.vendors.length
        ? el(
            "ul",
            { class: "v-found", "aria-label": `Google Maps results ${res.where}` },
            res.vendors.map((f) => {
              const added = mine.has(f.name.trim().toLowerCase());
              return el(
                "li",
                { class: "v-found-item" },
                el(
                  "div",
                  { class: "v-who" },
                  el("strong", null, f.name),
                  f.rating !== undefined
                    ? el(
                        "span",
                        { class: "v-note" },
                        `★ ${f.rating}${f.ratingCount !== undefined ? ` (${f.ratingCount.toLocaleString("en-IN")} reviews)` : ""}`,
                      )
                    : null,
                  f.address ? el("span", { class: "v-phone" }, f.address) : null,
                ),
                el(
                  "div",
                  { class: "row-actions" },
                  f.phone ? el("a", { class: "btn-quiet btn-link", href: `tel:${f.phone.replace(/[^\d+]/g, "")}` }, "Call") : null,
                  el("a", { class: "btn-quiet btn-link", href: f.mapsUrl, target: "_blank", rel: "noopener" }, "Open in Maps"),
                  el(
                    "button",
                    {
                      type: "button",
                      class: added ? "btn-quiet" : "btn-primary",
                      disabled: added,
                      onclick: () => {
                        if (!state.vendorList) state.vendorList = [];
                        const list = state.vendorList;
                        if (list.length >= MAX_VENDORS) return;
                        list.push({
                          id: `v${Date.now().toString(36)}`,
                          cat: c.key,
                          name: f.name.slice(0, 60),
                          phone: (f.phone && cleanPhone(f.phone)) || "",
                          status: "to-contact",
                        });
                        save();
                        renderVendors();
                      },
                    },
                    added ? "In your list" : "Add to my list",
                  ),
                ),
              );
            }),
          )
        : el(
            "p",
            { class: "v-find-status" },
            `No listings found ${res.where === "near you" ? "near you" : `in ${res.where}`}. Try a nearby bigger city.`,
          ),
    );
  }
  return box;
}

/**
 * Google searches built by code, so families can see real published prices themselves.
 * Toran never shows a price it can't source, so it doesn't summarise these pages.
 */
export function priceLinks(c, city) {
  const where = city || "India";
  const guests = state.plan.input.guestCount;
  const unitHint = c.line === "catering" ? ` per plate for ${guests} guests` : c.line === "venue" ? ` for ${guests} guests` : "";
  // udm=50 opens Google's AI Mode, which searches and cites its sources. If it isn't
  // available, Google shows normal results for the same question.
  const ask = `What do ${c.search} in ${where} typically charge${unitHint}? Show price ranges with sources.`;
  const qs = [`${c.search} price ${where}`, `${c.search} rates ${where} wedmegood`];
  const g = (q, ai) => `https://www.google.com/search?q=${encodeURIComponent(q)}${ai ? "&udm=50" : ""}`;
  return el(
    "div",
    { class: "v-price" },
    el(
      "p",
      { class: "v-price-label" },
      "Published prices vary a lot and are often out of date. Use them for budgeting only, and confirm with the vendor.",
    ),
    el("p", null, el("a", { class: "btn-quiet btn-link", href: g(ask, true), target: "_blank", rel: "noopener" }, "Ask Google AI Mode")),
    el(
      "p",
      { class: "v-gsearch" },
      "Or search: ",
      qs.map((q) => el("a", { class: "chip-link", href: g(q, false), target: "_blank", rel: "noopener" }, q)),
    ),
  );
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

/**
 * Records a deal against a budget line: on a timeline task that books it (so the task ticks),
 * else as a line cost. A vendor already booked on a task keeps that task, so re-confirming edits
 * the same booking instead of adding a second one.
 */
export function bookLine(lineKey, deal, vendor) {
  const tasks = state.plan.timeline.tasks.filter((t) => t.books === lineKey);
  const own = vendor?.booking?.taskId;
  const task = (own && tasks.find((t) => t.id === own)) || tasks.find((t) => !state.deals[t.id]) || tasks[0];
  const booking = task ? { taskId: task.id } : { lineKey };
  // One booking per task: another vendor booked on the same slot steps back to "shortlisted".
  for (const o of state.vendorList || []) {
    if (
      o !== vendor &&
      o.status === "confirmed" &&
      o.booking &&
      o.booking.taskId === booking.taskId &&
      o.booking.lineKey === booking.lineKey
    ) {
      o.status = "shortlisted";
      if (o.agreedINR) o.quoteINR = o.agreedINR;
      delete o.agreedINR;
      delete o.advanceINR;
      delete o.booking;
    }
  }
  if (task) {
    state.deals[task.id] = deal;
    state.done[task.id] = true;
  } else state.lineCosts[lineKey] = deal;
  if (vendor) vendor.booking = booking;
  return booking;
}

/** Undoes a vendor's booking, so the task reopens and the budget line goes back to its estimate. */
export function unbook(v) {
  const b = v.booking;
  if (b?.taskId) {
    delete state.deals[b.taskId];
    delete state.done[b.taskId];
  } else if (b?.lineKey) delete state.lineCosts[b.lineKey];
  delete v.booking;
  delete v.agreedINR;
  delete v.advanceINR;
}
