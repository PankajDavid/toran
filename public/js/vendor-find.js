/*
 * Toran front end · Find vendors on Google Maps, and code-built searches for published prices.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { el } from "./dom.js";
import { api, MIN_GAP_MS, save, state } from "./store.js";
import { cleanPhone } from "./vendor-contact.js";
import { MAX_VENDORS, openVendorCats, renderVendors } from "./vendors.js";

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
