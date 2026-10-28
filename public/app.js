"use strict";
/*
 * Toran front end. Plain JavaScript, no framework.
 * Security: every piece of text is inserted with textContent (never innerHTML),
 * so nothing from the server, the AI or the user can run as code.
 * State lives only in this browser (localStorage), never on our server.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = "toran.v1";
  const MIN_GAP_MS = 2000; // throttle for anything that can trigger an AI call

  /* ---------- tiny DOM helper ---------- */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  /* ---------- formatting ---------- */
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const fmtDate = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
  const pct = (bp) => (bp / 100).toFixed(bp % 100 ? 1 : 0) + "%";

  const LABELS = {
    eventType: { wedding: "Wedding", birthday: "Birthday", party: "Get-together", community: "Community event" },
    subType: {
      punjabi: "Punjabi", "south-indian": "South Indian", bengali: "Bengali", christian: "Christian", other: "Other style",
      kid: "Child's birthday", adult: "Adult's birthday", milestone: "Milestone birthday",
      kitty: "Kitty party", anniversary: "Anniversary",
      jagran: "Jagran", langar: "Langar", "diwali-mela": "Diwali mela", "rwa-function": "Society function",
    },
    cityTier: { 1: "Metro", 2: "Large city", 3: "Smaller town" },
    diet: { veg: "Vegetarian", jain: "Jain", "non-veg": "Non-veg", mixed: "Veg + non-veg" },
  };
  const subTypeLabel = (k) => (k.eventType === "community" && k.subType === "other" ? "Community event" : k.eventType === "party" && k.subType === "other" ? "Get-together" : LABELS.subType[k.subType] || k.subType);

  function describeField(field, k) {
    switch (field) {
      case "eventType": return LABELS.eventType[k.eventType];
      case "subType": return subTypeLabel(k);
      case "subEvents": return k.subEvents.map((s) => s[0].toUpperCase() + s.slice(1)).join(", ");
      case "eventDate": return fmtDate(k.eventDate);
      case "eventMonth": return "In " + MONTHS_LONG[k.eventMonth - 1];
      case "guestCount": return `About ${k.guestCount.toLocaleString("en-IN")} guests`;
      case "totalBudgetINR": return inr(k.totalBudgetINR);
      case "city": return k.city;
      case "cityTier": return LABELS.cityTier[k.cityTier];
      case "diet": return LABELS.diet[k.diet];
      default: return "";
    }
  }
  const FIELD_ORDER = ["eventType", "subType", "subEvents", "eventDate", "eventMonth", "guestCount", "totalBudgetINR", "city", "cityTier", "diet"];

  /* ---------- state ---------- */
  let state = load() || fresh();
  function fresh() { return { known: {}, guessed: [], planInput: null, plan: null, done: {}, deals: {}, lineCosts: {}, quotes: [], vendorList: [], ideas: null, chat: [] }; }
  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); return s && typeof s === "object" ? { ...fresh(), ...s } : null; }
    catch { return null; }
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage may be blocked; app still works */ } }

  /* ---------- network ---------- */
  let lastAiCall = 0;
  async function api(path, body, { ai = false } = {}) {
    if (ai) {
      const wait = lastAiCall + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAiCall = Date.now();
    }
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { data, status: res.status });
    return data;
  }

  /* ---------- screens ---------- */
  function show(screen) {
    for (const id of ["welcome", "interview", "plan"]) $(id).hidden = id !== screen;
    $("restart").hidden = screen === "welcome";
    window.scrollTo({ top: 0 });
  }

  /* ---------- interview ---------- */
  let current = null; // the question being asked
  let multi = new Set(); // ticked options for a multi-select question
  let busy = false;

  function addMsg(who, text, extraClass) {
    state.chat.push({ who, text });
    if (state.chat.length > 60) state.chat.splice(0, state.chat.length - 60);
    renderMsg(who, text, extraClass);
    save();
  }
  function renderMsg(who, text, extraClass) {
    const chat = $("chat");
    const node = el("div", { class: `msg ${who}${extraClass ? " " + extraClass : ""}` }, text);
    chat.append(node);
    node.scrollIntoView({ block: "end", behavior: "smooth" });
    return node;
  }

  function renderKnown() {
    const list = $("known-list");
    list.replaceChildren();
    const k = state.known;
    const fields = FIELD_ORDER.filter((f) => k[f] !== undefined);
    $("known").hidden = fields.length === 0;
    let anyGuess = false;
    for (const f of fields) {
      const guess = state.guessed.includes(f);
      anyGuess ||= guess;
      const label = describeField(f, k);
      list.append(el("li", null, el("button", {
        type: "button",
        class: guess ? "guess" : "",
        "aria-label": `${label}${guess ? " (my guess)" : ""}. Tap to change`,
        onclick: () => changeField(f),
      }, label + (guess ? " · guess" : ""))));
    }
    $("known-hint").hidden = !anyGuess;
  }

  function renderQuestion(q) {
    current = q;
    multi = new Set();
    const chips = $("chips");
    chips.replaceChildren();
    const say = $("say");
    const date = $("date");
    if (!q) return;
    say.placeholder = q.placeholder || "Type your answer";
    date.hidden = q.input !== "date";
    if (q.input === "date") {
      const today = new Date();
      date.min = today.toISOString().slice(0, 10);
      date.value = "";
    }
    for (const opt of q.options) {
      if (q.mode === "multi") {
        const value = opt.set.subEvents[0];
        const chip = el("button", { type: "button", class: "chip", "aria-pressed": "false" }, opt.label);
        chip.addEventListener("click", () => {
          if (multi.has(value)) multi.delete(value); else multi.add(value);
          chip.setAttribute("aria-pressed", String(multi.has(value)));
        });
        chips.append(chip);
      } else {
        chips.append(el("button", { type: "button", class: "chip", onclick: () => turn({ set: opt.set }, opt.label) }, opt.label));
      }
    }
    if (q.mode === "multi") {
      chips.append(el("button", { type: "button", class: "btn-primary", onclick: () => {
        if (!multi.size) { $("mic-status").textContent = "Tick at least one, then press Done."; return; }
        const picked = [...multi];
        turn({ set: { subEvents: picked } }, picked.map((s) => s[0].toUpperCase() + s.slice(1)).join(", "));
      } }, "Done"));
    }
  }

  function askCurrent(q) {
    if (q) addMsg("toran", q.text);
    renderQuestion(q);
  }

  async function turn(payload, echo) {
    if (busy) return;
    busy = true;
    setBusy(true);
    if (echo) addMsg("you", echo);
    const thinking = renderMsg("toran", "…", "thinking");
    try {
      const r = await api("/api/interview", { ...payload, known: state.known, guessed: state.guessed }, { ai: !!payload.text });
      thinking.remove();
      state.known = r.known;
      state.guessed = r.guessed;
      save();
      renderKnown();
      if (r.notUnderstood) {
        addMsg("toran", "Sorry, I didn't catch that. Tap an option, or try saying it differently.");
        renderQuestion(current);
      } else {
        const noted = r.noted.filter((f) => f !== "eventMonth" || !r.known.eventDate);
        if (payload.text && noted.length) {
          addMsg("toran", "Noted: " + noted.map((f) => describeField(f, r.known)).filter(Boolean).join(" · "));
        }
        if (r.planInput) await buildPlan(r.planInput);
        else askCurrent(r.next);
      }
    } catch (err) {
      thinking.remove();
      addMsg("toran", err.status === 429 ? "That's a lot of messages quickly. Please wait a minute and try again." : "Something went wrong on my side. Please try again.");
      renderQuestion(current);
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  function setBusy(on) {
    $("send").disabled = on;
    for (const b of $("chips").querySelectorAll("button")) b.disabled = on;
  }

  function changeField(field) {
    const k = { ...state.known };
    delete k[field];
    if (field === "eventType") { delete k.subType; delete k.subEvents; }
    if (field === "city") delete k.cityTier;
    state.known = k;
    state.guessed = state.guessed.filter((f) => f !== field);
    state.planInput = null;
    state.plan = null;
    save();
    show("interview");
    renderKnown();
    turn({});
  }

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("say").value.trim();
    const date = $("date");
    if (current && current.input === "date" && date.value) {
      const v = date.value;
      date.value = "";
      turn({ set: { eventDate: v } }, fmtDate(v));
      return;
    }
    if (!text) return;
    $("say").value = "";
    turn({ text }, text);
  });

  /* ---------- voice input (browser speech recognition) ---------- */
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Speech) {
    const mic = $("mic");
    mic.hidden = false;
    let rec = null;
    mic.addEventListener("click", () => {
      if (rec) { rec.stop(); return; }
      rec = new Speech();
      rec.lang = "en-IN"; // understands Indian English and Hinglish spoken in Roman script
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      mic.setAttribute("aria-pressed", "true");
      $("mic-status").textContent = "Listening… speak naturally, in Hindi or English.";
      let finalText = "";
      rec.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalText += t; else interim += t;
        }
        $("say").value = (finalText + interim).slice(0, 500);
      };
      rec.onerror = (ev) => {
        $("mic-status").textContent = ev.error === "not-allowed" ? "Microphone access was blocked. You can type instead." : "I couldn't hear that. Try again or type.";
      };
      rec.onend = () => {
        mic.setAttribute("aria-pressed", "false");
        rec = null;
        const text = $("say").value.trim();
        if (text) {
          $("mic-status").textContent = "";
          $("say").value = "";
          turn({ text }, text);
        } else if (!$("mic-status").textContent.startsWith("Microphone")) {
          $("mic-status").textContent = "";
        }
      };
      rec.start();
    });
  }

  /* ---------- plan ---------- */
  /** Bookings recorded on this device, sent with the plan so code can re-balance the budget. */
  function dealList() {
    return [
      ...Object.entries(state.deals || {}).map(([taskId, d]) => ({ taskId, agreedINR: d.agreedINR, advanceINR: d.advanceINR })),
      ...Object.entries(state.lineCosts || {}).map(([lineKey, d]) => ({ lineKey, agreedINR: d.agreedINR, advanceINR: d.advanceINR })),
    ];
  }

  const doneList = () => Object.keys(state.done || {}).filter((k) => state.done[k]);

  /** Re-runs the calculator (no AI) after a booking or tick changes. */
  async function refreshPlan() {
    try {
      state.plan = await api("/api/plan", { ...state.planInput, deals: dealList(), done: doneList() });
      save();
    } catch {
      $("warnings").prepend(el("p", { class: "warning" }, "Couldn't update the budget just now. Please try again."));
    }
    renderPlan();
  }

  /** Reads "2,80,000", "280000", "2.8 lakh", "2.8L" or "75k" as whole rupees. */
  function parseRupees(text) {
    const t = String(text).toLowerCase().replace(/[₹,\s]|rs\.?/g, "");
    const m = /^(\d+(?:\.\d+)?)(crore|cr|lakh|lakhs|lac|l|k)?$/.exec(t);
    if (!m) return null;
    const mult = { crore: 1e7, cr: 1e7, lakh: 1e5, lakhs: 1e5, lac: 1e5, l: 1e5, k: 1e3 }[m[2]] || 1;
    const n = Math.round(Number(m[1]) * mult);
    return Number.isFinite(n) && n >= 0 && n <= 5e7 ? n : null;
  }

  async function buildPlan(planInput) {
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
      const issue = err.data && err.data.issues && err.data.issues[0];
      addMsg("toran", issue ? `One thing needs fixing: ${issue.message}. Tap it above to change it.` : "I couldn't build the plan just now. Please try again.");
    }
  }

  function playReady() {
    const ready = $("ready");
    ready.hidden = false;
    // Restart CSS animations each time.
    const clone = ready.cloneNode(true);
    ready.replaceWith(clone);
    clone.addEventListener("animationend", (e) => { if (e.animationName === "ready-out") clone.hidden = true; });
    setTimeout(() => { clone.hidden = true; }, 4500);
  }

  /**
   * Inline form under a budget line. It shows EVERY cost already recorded on this
   * line, each editable in place, so editing never adds a second copy:
   *  - one row per timeline booking that books this line, and
   *  - one "other costs" row for anything no task covers (optional).
   */
  function openLineCost(tr, line) {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("cost-row")) { next.remove(); return; }
    const tasks = state.plan.timeline.tasks.filter((t) => t.books === line.key && state.deals[t.id]);
    const own = state.lineCosts[line.key];
    const msg = el("p", { class: "booking-msg", role: "alert" });
    const entries = []; // { kind, id, label, agreed, advance }

    function entry(kind, id, label, hint, current) {
      const aId = `cost-a-${kind}-${id}`, pId = `cost-p-${kind}-${id}`;
      const agreed = el("input", { id: aId, type: "text", inputmode: "decimal", placeholder: kind === "line" ? "Leave empty if none" : "e.g. 60,000" });
      const advance = el("input", { id: pId, type: "text", inputmode: "decimal", placeholder: "0 if none yet" });
      if (current) { agreed.value = String(current.agreedINR); advance.value = String(current.advanceINR); }
      entries.push({ kind, id, label, agreed, advance });
      return el("fieldset", { class: "cost-entry" },
        el("legend", null, label),
        hint ? el("p", { class: "booking-hint" }, hint) : null,
        el("div", { class: "cost-pair" },
          el("div", null, el("label", { for: aId }, "Agreed or spent"), agreed),
          el("div", null, el("label", { for: pId }, "Paid so far"), advance)));
    }

    const fields = [
      ...tasks.map((t) => entry("task", t.id, `From the timeline: ${t.title}`, null, state.deals[t.id])),
      entry("line", line.key, tasks.length ? "Other costs for this line" : line.label,
        tasks.length ? "Only costs the timeline booking above doesn't already include." : null, own),
    ];

    const form = el("form", { class: "booking" },
      el("p", { class: "booking-title" }, `${line.label}: planned ${inr(line.plannedINR)}`),
      ...fields,
      msg,
      el("div", { class: "booking-actions" },
        el("button", { type: "submit", class: "btn-primary" }, "Save"),
        tasks.length ? null : el("button", { type: "button", class: "btn-quiet", onclick: () => {
          state.lineCosts[line.key] = { agreedINR: 0, advanceINR: 0 };
          save();
          refreshPlan();
        } }, "Not needed (₹0)"),
        el("button", { type: "button", class: "btn-quiet", onclick: () => row.remove() }, "Cancel")));

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const updates = [];
      for (const f of entries) {
        const aText = f.agreed.value.trim();
        const pText = f.advance.value.trim();
        if (!aText) {
          if (f.kind === "task") { msg.textContent = `Enter the agreed price for "${f.label.replace("From the timeline: ", "")}", or untick that task in the timeline to remove it.`; f.agreed.focus(); return; }
          updates.push({ f, value: null }); // empty "other costs" = remove it
          continue;
        }
        const a = parseRupees(aText);
        const adv = pText ? parseRupees(pText) : 0;
        if (a === null) { msg.textContent = "Enter amounts in rupees, like 60,000 or 1.5 lakh."; f.agreed.focus(); return; }
        if (adv === null) { msg.textContent = "Enter what's paid in rupees, or leave it empty."; f.advance.focus(); return; }
        if (adv > a) { msg.textContent = "What's paid can't be more than the amount."; f.advance.focus(); return; }
        updates.push({ f, value: { agreedINR: a, advanceINR: adv } });
      }
      for (const { f, value } of updates) {
        if (f.kind === "task") state.deals[f.id] = value;
        else if (value) state.lineCosts[f.id] = value; // ₹0 = "not needed", kept on purpose
        else delete state.lineCosts[f.id];
      }
      save();
      refreshPlan();
    });
    const row = el("tr", { class: "cost-row" }, el("td", { colspan: "3" }, form));
    tr.after(row);
    (entries[0].agreed).focus();
  }

  /** Inline "deal closed" form under a booking task. */
  function openBooking(li, task, line) {
    if (li.querySelector(".booking")) return;
    const agreedId = `agreed-${task.id}`, advId = `adv-${task.id}`;
    const msg = el("p", { class: "booking-msg", role: "alert" });
    const agreed = el("input", { id: agreedId, type: "text", inputmode: "decimal", placeholder: "e.g. 2,80,000 or 2.8 lakh", required: true });
    const advance = el("input", { id: advId, type: "text", inputmode: "decimal", placeholder: "0 if none yet" });
    const form = el("form", { class: "booking" },
      el("p", { class: "booking-title" }, `Booked! ${line ? `Planned for ${line.label}: ${inr(line.amountINR)}.` : ""}`),
      el("label", { for: agreedId }, "Final agreed price"), agreed,
      el("label", { for: advId }, "Advance paid"), advance,
      msg,
      el("div", { class: "booking-actions" },
        el("button", { type: "submit", class: "btn-primary" }, "Save booking"),
        el("button", { type: "button", class: "btn-quiet", onclick: () => {
          state.deals[task.id] = { agreedINR: 0, advanceINR: 0 };
          state.done[task.id] = true;
          save();
          refreshPlan();
        } }, "Not needed (₹0)"),
        el("button", { type: "button", class: "btn-quiet", onclick: () => {
          state.done[task.id] = true;
          save();
          refreshPlan();
        } }, "Done, cost later"),
        el("button", { type: "button", class: "btn-quiet", onclick: () => form.remove() }, "Cancel")));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const a = parseRupees(agreed.value);
      const adv = advance.value.trim() ? parseRupees(advance.value) : 0;
      if (a === null) { msg.textContent = "Enter the agreed price in rupees, like 2,80,000 or 2.8 lakh."; agreed.focus(); return; }
      if (adv === null) { msg.textContent = "Enter the advance in rupees, or leave it empty."; advance.focus(); return; }
      if (adv > a) { msg.textContent = "The advance can't be more than the agreed price."; advance.focus(); return; }
      state.deals[task.id] = { agreedINR: a, advanceINR: adv };
      state.done[task.id] = true;
      save();
      refreshPlan();
    });
    li.append(form);
    agreed.focus();
  }

  function renderPlan() {
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
    ].filter(Boolean).join(" · ");

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
        el("div", { class: cls || "" }, el("span", { class: "k" }, label), el("strong", null, value), sub ? el("span", { class: "s" }, sub) : null);
      summary.append(
        tile("Total budget", inr(p.budget.totalINR)),
        tile("Booked", inr(sp.agreedINR), `estimated ${inr(sp.bookedPlannedINR)}${diff ? ` · ${diff > 0 ? inr(diff) + " over" : inr(-diff) + " saved"}` : ""}`, diff > 0 ? "warn" : diff < 0 ? "good" : ""),
        tile("Paid so far", inr(sp.advanceINR)),
        tile("Balance due", inr(sp.dueINR), "on bookings made"),
        tile("Still to book", inr(sp.unbookedPlannedINR),
          sp.unbookedPlannedINR ? sp.lines.filter((l) => !l.booked && l.key !== "contingency").map((l) => l.label).join(", ") : "everything is booked"),
        sp.overBudgetINR
          ? tile("Over budget", inr(sp.overBudgetINR), "after using the buffer", "over")
          : tile("Buffer left", inr(sp.contingencyNowINR), `planned ${inr(sp.contingencyPlannedINR)}`),
      );
    }
    const bpByKey = Object.fromEntries(p.budget.lines.map((l) => [l.key, l.bp]));
    const maxBp = Math.max(...p.budget.lines.map((l) => l.bp));
    $("budget-rows").replaceChildren(...sp.lines.map((l) => {
      const bar = el("span", { class: "bar", "aria-hidden": "true" });
      bar.style.width = `${Math.max(3, (bpByKey[l.key] / maxBp) * 100)}%`; // biggest line fills the cell
      const isBuffer = l.key === "contingency";
      let note = null;
      if (l.booked) {
        const diff = l.differenceINR;
        note = el("span", { class: "line-note" },
          el("span", null, `Planned ${inr(l.plannedINR)}${diff ? ` · ${diff > 0 ? "over by " + inr(diff) : "saved " + inr(-diff)}` : ""}`),
          el("span", null, `Advance ${inr(l.advanceINR)} · due ${inr(l.dueINR)}`));
      } else if (isBuffer && sp.bookedCount && sp.contingencyNowINR !== l.plannedINR) {
        note = el("span", { class: "line-note" }, `Planned ${inr(l.plannedINR)} · adjusted for your bookings`);
      }
      const amount = l.booked ? l.agreedINR : isBuffer ? sp.contingencyNowINR : l.plannedINR;
      const hasCost = l.booked; // from a timeline booking and/or a recorded cost
      const costBtn = isBuffer ? null : el("button", {
        type: "button", class: "link-btn",
        "aria-label": `${hasCost ? "Edit" : "Record"} cost for ${l.label}`,
        onclick: (e) => openLineCost(e.currentTarget.closest("tr"), l),
      }, hasCost ? "Edit cost" : "Record cost");
      return el("tr", { class: l.booked ? "booked" : "" },
        el("th", { scope: "row" }, l.label, l.booked ? el("span", { class: "badge booked" }, l.agreedINR === 0 ? "not needed" : "booked") : null, note, bar, costBtn),
        el("td", { class: "num" }, inr(amount)),
        el("td", { class: "num share" }, pct(bpByKey[l.key])));
    }));
    // Total = what the lines above add up to. When bookings push past the budget, say both.
    const projected = sp.projectedSpendINR;
    $("budget-total").replaceChildren(inr(projected),
      sp.overBudgetINR ? el("span", { class: "line-note over-note" }, `Budget ${inr(p.budget.totalINR)}`) : "");

    // Timeline
    const doneCount = p.timeline.tasks.filter((t) => state.done[t.id]).length;
    $("timeline-sub").textContent = `${doneCount} of ${p.timeline.tasks.length} done${p.timeline.lateCount ? ` · ${p.timeline.lateCount} behind schedule` : ""}`;
    const lineLabel = Object.fromEntries(p.budget.lines.map((l) => [l.key, l]));
    $("tasks").replaceChildren(...p.timeline.tasks.map((t) => {
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
      li.append(box,
        el("label", { for: id }, t.title,
          !done && t.status !== "upcoming" ? el("span", { class: `badge ${t.status}` }, t.status === "late" ? "late" : "this week") : null,
          el("span", { class: "when" }, deal ? (deal.agreedINR === 0 ? "Not needed" : `Booked for ${inr(deal.agreedINR)} · advance ${inr(deal.advanceINR)}`) : when)));
      return li;
    }));

    renderVendors();

    renderIdeas();
    renderQuoteStart();
    updateInstall();
  }

  /* ---------- ideas ---------- */
  function renderIdeas() {
    const box = $("ideas");
    box.replaceChildren();
    const r = state.ideas;
    $("get-ideas").hidden = !!r;
    $("refine").hidden = !r;
    if (!r) return;
    const i = r.ideas;
    if (i.themes.length) {
      box.append(el("div", { class: "ideas-block" }, el("h3", null, "Themes"),
        i.themes.map((t) => el("div", { class: "theme" }, el("strong", null, t.name),
          t.colours.length ? el("div", { class: "swatches" }, t.colours.map((c) => el("span", { class: "swatch" }, c))) : null,
          t.description))));
    }
    if (i.decor.length) box.append(el("div", { class: "ideas-block" }, el("h3", null, "Decor"), el("ul", null, i.decor.map((d) => el("li", null, d)))));
    if (i.menu.length) {
      box.append(el("div", { class: "ideas-block" }, el("h3", null, "Menu"),
        i.menu.map((c) => el("div", null, el("strong", null, c.course), el("ul", null, c.items.map((x) => el("li", null, x)))))));
    }
    if (i.invitation) {
      box.append(el("div", { class: "ideas-block" }, el("h3", null, "Invitation wording"),
        el("p", { class: "invitation" }, i.invitation),
        el("div", { class: "row-actions" },
          el("a", { class: "btn-primary btn-link", href: whatsappUrl(i.invitation), target: "_blank", rel: "noopener" }, "Send on WhatsApp"),
          el("button", { type: "button", class: "btn-quiet", onclick: (e) => copyText(i.invitation, e.currentTarget) }, "Copy"))));
    }
    if (i.tips.length) box.append(el("div", { class: "ideas-block" }, el("h3", null, "Tips"), el("ul", null, i.tips.map((t) => el("li", null, t)))));
    const notes = [];
    if (r.source === "offline") notes.push("These come from our curated set because the AI is offline right now.");
    if (r.removed) notes.push(`${r.removed} AI suggestion${r.removed === 1 ? " was" : "s were"} removed by our checks (prices, or food that doesn't fit your diet).`);
    if (notes.length) box.append(el("p", { class: "source-note" }, notes.join(" ")));
  }

  async function loadIdeas(refine) {
    const btn = $("get-ideas");
    btn.disabled = true;
    btn.textContent = "Thinking up ideas… (about 10 seconds)";
    const box = $("ideas");
    if (refine) box.prepend(el("p", { class: "source-note" }, "Refining…"));
    try {
      state.ideas = await api("/api/ideas", { plan: state.planInput, ...(refine ? { refine } : {}) }, { ai: true });
      save();
    } catch (err) {
      box.prepend(el("p", { class: "warning" }, err.status === 429 ? "Too many requests. Please wait a minute." : "Couldn't get ideas just now. Please try again."));
    } finally {
      btn.disabled = false;
      btn.textContent = "Get ideas";
      renderIdeas();
    }
  }
  $("get-ideas").addEventListener("click", () => loadIdeas());
  $("refine").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = $("refine-text").value.trim();
    if (t) loadIdeas(t);
  });

  /* ---------- Vendor checklist & tracker ---------- */
  // Per category: the questions to ask, plus the vendors you're talking to and where
  // each one stands. Confirming a vendor books their price on the matching budget line.
  const VSTATUS = [
    ["to-contact", "To contact"], ["contacted", "Contacted"], ["quote", "Quote received"], ["shortlisted", "Shortlisted"],
    ["confirmed", "Confirmed"], ["not-chosen", "Not chosen"],
  ];
  const VRANK = { "to-contact": 0, contacted: 1, quote: 2, shortlisted: 3, confirmed: 4, "not-chosen": -1 };
  const MAX_VENDORS = 60;
  const openVendorCats = new Set();

  /** Accepts Indian numbers like 98765 43210, +91-98765-43210 or 0172 2700000; returns digits or null. */
  function cleanPhone(text) {
    const d = String(text || "").replace(/[\s().-]/g, "");
    if (!d) return "";
    if (!/^\+?\d{6,13}$/.test(d)) return null;
    const digits = d.replace(/^\+/, "");
    if (/^91\d{10}$/.test(digits)) return digits.slice(2); // +91 98765 43210 → 9876543210
    if (/^0\d{10}$/.test(digits) && /^0[6-9]/.test(digits)) return digits.slice(1); // 09876543210
    return digits;
  }
  /** wa.me needs the country code; a 10-digit Indian mobile gets 91. */
  const waNumber = (digits) => (digits.length === 10 ? "91" + digits : /^0\d{10}$/.test(digits) ? "91" + digits.slice(1) : digits);
  const showPhone = (digits) => (digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits);

  function vendorIntro(v, cat) {
    const k = state.plan.input;
    const typeLabel = k.eventType === "wedding" ? `${subTypeLabel(k)} wedding` : subTypeLabel(k).toLowerCase();
    const qs = cat.questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
    return `Namaste ${v.name.replace(/\s+ji$/i, "")} ji,\nWe're planning a ${typeLabel} on ${fmtDate(k.eventDate)}${k.city ? " in " + k.city : ""} for about ${k.guestCount.toLocaleString("en-IN")} guests.\nWe're looking for: ${cat.category}\n\nCould you please share your rates and answer these:\n${qs}\n\nThank you!`;
  }

  /** Adds or updates a tracked vendor after the Quote Checker reads or books their quote. */
  function trackVendorFromQuote(lineKey, name, { status, minStatus = false, totalINR, booking, advanceINR }) {
    const cat = state.plan && state.plan.vendors.find((v) => v.line === lineKey);
    if (!cat) return;
    const list = state.vendorList || (state.vendorList = []);
    const norm = (x) => x.trim().toLowerCase();
    let v = list.find((x) => x.cat === cat.key && norm(x.name) === norm(name));
    if (!v) {
      if (list.length >= MAX_VENDORS) return;
      v = { id: "v" + Date.now().toString(36), cat: cat.key, name: name.slice(0, 60), phone: "", status: "contacted" };
      list.push(v);
    }
    if (!minStatus || VRANK[v.status] < VRANK[status]) v.status = status;
    if (totalINR) v.quoteINR = totalINR;
    if (booking) {
      for (const o of list) if (o !== v && o.status === "confirmed" && o.booking && o.booking.taskId === booking.taskId && o.booking.lineKey === booking.lineKey) { o.status = "shortlisted"; delete o.booking; }
      v.booking = booking; v.agreedINR = totalINR; v.advanceINR = advanceINR;
    }
    save();
    renderVendors();
  }

  function renderVendors() {
    const p = state.plan;
    const list = state.vendorList || [];
    const cats = p.vendors;
    const confirmedCats = cats.filter((c) => list.some((v) => v.cat === c.key && v.status === "confirmed")).length;
    const inTalks = list.filter((v) => v.status !== "confirmed" && v.status !== "not-chosen" && cats.some((c) => c.key === v.cat)).length;
    $("vendors-sub").textContent = list.length
      ? `${confirmedCats} of ${cats.length} confirmed · ${inTalks} vendor${inTalks === 1 ? "" : "s"} in talks`
      : "Questions to ask before you pay any advance. Add the vendors you're talking to and track each one.";

    $("vendors").replaceChildren(...cats.map((c) => {
      const mine = list.filter((v) => v.cat === c.key);
      const confirmed = mine.find((v) => v.status === "confirmed");
      const line = c.line ? state.plan.spending.lines.find((l) => l.key === c.line) : null;
      const det = el("details", { class: "vendor", open: openVendorCats.has(c.key) },
        el("summary", null,
          el("span", { class: "v-cat" }, c.category),
          confirmed ? el("span", { class: "badge booked" }, "confirmed")
            : mine.length ? el("span", { class: "badge talks" }, `${mine.filter((v) => v.status !== "not-chosen").length} in talks`) : null,
          line ? el("span", { class: "v-planned" }, `planned ${inr(line.plannedINR)}`) : null),
        el("p", { class: "v-label" }, "Ask before paying any advance"),
        el("ul", { class: "v-questions" }, c.questions.map((q) => el("li", null, q))),
        mine.length ? el("ul", { class: "v-list", "aria-label": `${c.category} vendors` }, mine.map((v) => vendorRow(v, c, line))) : null,
        findBox(c),
        addVendorForm(c));
      det.addEventListener("toggle", () => { if (det.open) openVendorCats.add(c.key); else openVendorCats.delete(c.key); });
      return det;
    }));
  }

  function vendorRow(v, c, line) {
    const selId = `vs-${v.id}`;
    const sel = el("select", { id: selId, class: "v-status" }, VSTATUS.map(([k, label]) => el("option", { value: k, selected: v.status === k }, label)));
    const li = el("li", { class: `v-item s-${v.status}` },
      el("div", { class: "v-top" },
        el("div", { class: "v-who" },
          el("strong", null, v.name),
          v.phone ? el("span", { class: "v-phone" }, showPhone(v.phone)) : null,
          v.status === "confirmed" && v.agreedINR !== undefined ? el("span", { class: "v-note" }, v.agreedINR === null ? "Confirmed" : `Booked for ${inr(v.agreedINR)}`)
            : v.quoteINR ? el("span", { class: "v-note" }, `Quote: ${inr(v.quoteINR)}`) : null),
        el("div", { class: "v-state" }, el("label", { class: "sr-only", for: selId }, `Status of ${v.name}`), sel)),
      el("div", { class: "row-actions" },
        v.phone ? el("a", { class: "btn-quiet btn-link", href: `tel:${v.phone}` }, "Call") : null,
        v.phone ? el("a", { class: "btn-quiet btn-link", href: `https://wa.me/${waNumber(v.phone)}?text=${encodeURIComponent(vendorIntro(v, c))}`, target: "_blank", rel: "noopener" }, "WhatsApp questions")
          : el("button", { type: "button", class: "btn-quiet", onclick: (e) => copyText(vendorIntro(v, c), e.currentTarget) }, "Copy questions"),
        line ? el("button", { type: "button", class: "btn-quiet", onclick: () => checkVendorQuote(v, c) }, "Check their quote") : null,
        v.status !== "confirmed" ? el("button", { type: "button", class: "btn-primary", onclick: () => openConfirmVendor(li, v, c, line) }, "Confirm") : null,
        el("button", { type: "button", class: "link-btn", "aria-label": `Remove ${v.name}`, onclick: () => {
          const wasBooked = v.status === "confirmed" && v.booking;
          if (wasBooked && !confirm(`Remove ${v.name}? Their booking of ${inr(v.agreedINR)} will be removed from your budget.`)) return;
          if (wasBooked) unbook(v);
          state.vendorList = state.vendorList.filter((x) => x.id !== v.id);
          save();
          if (wasBooked) refreshPlan(); else renderVendors();
        } }, "Remove")));
    sel.addEventListener("change", () => {
      if (sel.value === "confirmed") { sel.value = v.status; openConfirmVendor(li, v, c, line); return; }
      const wasBooked = v.status === "confirmed" && v.booking;
      v.status = sel.value;
      if (wasBooked) { unbook(v); save(); refreshPlan(); return; }
      save();
      renderVendors();
    });
    return li;
  }

  function addVendorForm(c) {
    const nameId = `vn-${c.key}`, phoneId = `vp-${c.key}`;
    const name = el("input", { id: nameId, type: "text", maxlength: "60", autocomplete: "off", placeholder: "e.g. Shubh Rasoi Caterers" });
    const phone = el("input", { id: phoneId, type: "tel", maxlength: "18", autocomplete: "off", placeholder: "optional" });
    const msg = el("p", { class: "booking-msg", role: "alert" });
    const form = el("form", { class: "v-add" },
      el("p", { class: "v-label" }, "Or add one you know"),
      el("div", { class: "v-add-fields" },
        el("div", { class: "field" }, el("label", { for: nameId }, "Vendor name"), name),
        el("div", { class: "field" }, el("label", { for: phoneId }, "Phone"), phone)),
      msg,
      el("button", { type: "submit", class: "btn-quiet" }, "Add vendor"));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const n = name.value.trim();
      const ph = cleanPhone(phone.value);
      if (!n) { msg.textContent = "Enter the vendor's name."; name.focus(); return; }
      if (ph === null) { msg.textContent = "That phone number doesn't look right. Use digits, like 98765 43210."; phone.focus(); return; }
      const list = state.vendorList || (state.vendorList = []);
      if (list.length >= MAX_VENDORS) { msg.textContent = `You can track up to ${MAX_VENDORS} vendors.`; return; }
      list.push({ id: "v" + Date.now().toString(36), cat: c.key, name: n, phone: ph, status: "contacted" });
      openVendorCats.add(c.key);
      save();
      renderVendors();
      const again = $(nameId);
      if (again) again.focus();
    });
    return form;
  }

  /* Find vendors near you: real Google Maps listings, kept in memory only (not saved). */
  const found = new Map(); // category key -> { where, vendors } | { error }
  let lastFind = 0;

  function findBox(c) {
    const k = state.plan.input;
    const box = el("div", { class: "v-find" });
    const res = found.get(c.key);
    const cityId = `vc-${c.key}`;
    const cityInput = el("input", { id: cityId, type: "text", maxlength: "60", autocomplete: "address-level2", placeholder: "e.g. Panchkula", value: k.city || null });
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
        found.set(c.key, { error: (err.data && err.data.error) || "Couldn't search just now. Please try again." });
      }
      openVendorCats.add(c.key);
      renderVendors();
    };
    box.append(
      el("p", { class: "v-label" }, "Find on Google Maps"),
      el("form", { class: "v-find-form", onsubmit: (e) => {
        e.preventDefault();
        const city = cityInput.value.trim();
        if (!/^[\p{L} .'-]{2,60}$/u.test(city)) { status.textContent = "Enter a city name, like Panchkula."; cityInput.focus(); return; }
        run({ city }, city);
      } },
        el("label", { class: "sr-only", for: cityId }, "City to search in"),
        cityInput,
        el("button", { type: "submit", class: "btn-quiet" }, "Search"),
        "geolocation" in navigator ? el("button", { type: "button", class: "btn-quiet", onclick: () => {
          status.textContent = "Getting your location…";
          navigator.geolocation.getCurrentPosition(
            // Rounded on this phone to about 1 km before it leaves; used once and never saved.
            (pos) => run({ near: { lat: Math.round(pos.coords.latitude * 100) / 100, lng: Math.round(pos.coords.longitude * 100) / 100 } }, "near you"),
            () => { status.textContent = "Location isn't available. Type your city instead."; },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
        } }, "Near me") : null),
      status);
    if (res && res.error) status.textContent = res.error;
    else if (res) {
      const mine = new Set((state.vendorList || []).filter((v) => v.cat === c.key).map((v) => v.name.trim().toLowerCase()));
      box.append(
        res.vendors.length ? el("ul", { class: "v-found", "aria-label": `Google Maps results ${res.where}` }, res.vendors.map((f) => {
          const added = mine.has(f.name.trim().toLowerCase());
          return el("li", { class: "v-found-item" },
            el("div", { class: "v-who" },
              el("strong", null, f.name),
              f.rating !== undefined ? el("span", { class: "v-note" }, `★ ${f.rating}${f.ratingCount !== undefined ? ` (${f.ratingCount.toLocaleString("en-IN")} reviews)` : ""}`) : null,
              f.address ? el("span", { class: "v-phone" }, f.address) : null),
            el("div", { class: "row-actions" },
              f.phone ? el("a", { class: "btn-quiet btn-link", href: `tel:${f.phone.replace(/[^\d+]/g, "")}` }, "Call") : null,
              el("a", { class: "btn-quiet btn-link", href: f.mapsUrl, target: "_blank", rel: "noopener" }, "Open in Maps"),
              el("button", { type: "button", class: added ? "btn-quiet" : "btn-primary", disabled: added, onclick: () => {
                const list = state.vendorList || (state.vendorList = []);
                if (list.length >= MAX_VENDORS) return;
                list.push({ id: "v" + Date.now().toString(36), cat: c.key, name: f.name.slice(0, 60), phone: (f.phone && cleanPhone(f.phone)) || "", status: "to-contact" });
                save();
                renderVendors();
              } }, added ? "In your list" : "Add to my list")));
        })) : el("p", { class: "v-find-status" }, `No listings found ${res.where === "near you" ? "near you" : "in " + res.where}. Try a nearby bigger city.`),
        el("p", { class: "fineprint-left" }, "Listings and ratings from Google Maps. Toran doesn't vouch for any vendor: check reviews, visit, and get a written quote."));
    }
    return box;
  }

  function checkVendorQuote(v, c) {
    $("quote-category").value = c.line;
    draftCategory = c.line;
    prefillVendor = v.name;
    $("quote-verdict").replaceChildren();
    $("quote-confirm").replaceChildren();
    $("quote-status").textContent = `Checking a quote from ${v.name}. Add a photo or PDF, or type it in.`;
    $("quote-card").scrollIntoView({ behavior: "smooth", block: "start" });
    $("quote-file").focus({ preventScroll: true });
  }

  /** Confirming a vendor records the deal on the timeline task that books their line, so budget and timeline both update. */
  function openConfirmVendor(li, v, c, line) {
    if (li.querySelector(".booking")) return;
    const agreedId = `va-${v.id}`, advId = `vadv-${v.id}`;
    const msg = el("p", { class: "booking-msg", role: "alert" });
    const known = v.agreedINR || v.quoteINR;
    const agreed = el("input", { id: agreedId, type: "text", inputmode: "decimal", placeholder: "e.g. 2,80,000 or 2.8 lakh", value: known ? known.toLocaleString("en-IN") : null });
    const advance = el("input", { id: advId, type: "text", inputmode: "decimal", placeholder: "0 if none yet", value: v.advanceINR ? v.advanceINR.toLocaleString("en-IN") : null });
    const form = el("form", { class: "booking" },
      el("p", { class: "booking-title" }, line ? `Confirm ${v.name}. Planned for ${line.label}: ${inr(line.plannedINR)}.` : `Confirm ${v.name}.`),
      line ? [el("label", { for: agreedId }, "Final agreed price"), agreed, el("label", { for: advId }, "Advance paid"), advance] : null,
      msg,
      el("div", { class: "booking-actions" },
        el("button", { type: "submit", class: "btn-primary" }, "Confirm vendor"),
        el("button", { type: "button", class: "btn-quiet", onclick: () => form.remove() }, "Cancel")));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!line) { v.status = "confirmed"; v.agreedINR = null; delete v.booking; save(); renderVendors(); return; }
      const a = parseRupees(agreed.value);
      const adv = advance.value.trim() ? parseRupees(advance.value) : 0;
      if (a === null) { msg.textContent = "Enter the agreed price in rupees, like 2,80,000 or 2.8 lakh."; agreed.focus(); return; }
      if (adv === null) { msg.textContent = "Enter the advance in rupees, or leave it empty."; advance.focus(); return; }
      if (adv > a) { msg.textContent = "The advance can't be more than the agreed price."; advance.focus(); return; }
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
  function bookLine(lineKey, deal, vendor) {
    const tasks = state.plan.timeline.tasks.filter((t) => t.books === lineKey);
    const own = vendor && vendor.booking && vendor.booking.taskId;
    const task = (own && tasks.find((t) => t.id === own)) || tasks.find((t) => !state.deals[t.id]) || tasks[0];
    const booking = task ? { taskId: task.id } : { lineKey };
    // One booking per task: another vendor booked on the same slot steps back to "shortlisted".
    for (const o of state.vendorList || []) {
      if (o !== vendor && o.status === "confirmed" && o.booking && o.booking.taskId === booking.taskId && o.booking.lineKey === booking.lineKey) {
        o.status = "shortlisted";
        delete o.booking;
      }
    }
    if (task) { state.deals[task.id] = deal; state.done[task.id] = true; }
    else state.lineCosts[lineKey] = deal;
    if (vendor) vendor.booking = booking;
    return booking;
  }

  /** Undoes a vendor's booking, so the task reopens and the budget line goes back to its estimate. */
  function unbook(v) {
    const b = v.booking;
    if (b && b.taskId) { delete state.deals[b.taskId]; delete state.done[b.taskId]; }
    else if (b && b.lineKey) delete state.lineCosts[b.lineKey];
    delete v.booking;
    delete v.agreedINR;
    delete v.advanceINR;
  }

  /* ---------- Quote Checker ---------- */
  // Flow: pick category → photo/PDF (resized on the phone) → AI draft → user confirms
  // every line → plain-code checks → verdict, vendor message, save to compare, book.
  let draftCategory = null;
  let prefillVendor = ""; // set when "Check their quote" is pressed on a vendor in the checklist

  function quoteLines() {
    return state.plan ? state.plan.spending.lines.filter((l) => l.key !== "contingency") : [];
  }
  function lineByKey(key) { return quoteLines().find((l) => l.key === key); }

  function renderQuoteStart() {
    const sel = $("quote-category");
    const keep = sel.value;
    sel.replaceChildren(...quoteLines().map((l) => el("option", { value: l.key }, `${l.label} (planned ${inr(l.plannedINR)})`)));
    if (keep && lineByKey(keep)) sel.value = keep;
    renderSavedQuotes();
  }

  /** Re-encodes photos on the phone: smaller upload, and strips hidden data such as GPS location. */
  async function prepareQuoteFile(file) {
    if (file.type === "application/pdf") {
      if (file.size > 8 * 1024 * 1024) throw new Error("That PDF is over 8 MB. Please send a smaller one or a photo.");
      return { blob: file, type: "application/pdf" };
    }
    if (!file.type.startsWith("image/")) throw new Error("Please choose a photo or a PDF.");
    let bmp;
    try { bmp = await createImageBitmap(file); } catch { throw new Error("Couldn't open this photo. Try a JPG or PNG."); }
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob) throw new Error("Couldn't prepare this photo.");
    return { blob, type: "image/jpeg" };
  }

  async function readQuoteFile(file) {
    const status = $("quote-status");
    $("quote-verdict").replaceChildren();
    $("quote-confirm").replaceChildren();
    draftCategory = $("quote-category").value;
    try {
      status.textContent = "Preparing the photo…";
      const { blob, type } = await prepareQuoteFile(file);
      status.textContent = "Reading your quote… this takes about 15 seconds.";
      const wait = lastAiCall + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAiCall = Date.now();
      const res = await fetch("/api/quote/read", { method: "POST", headers: { "content-type": type }, body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        status.textContent = data.error || "Couldn't read this quote.";
        if (data.manual) renderConfirm({ lines: [{ description: "" }], gst: { status: "not-mentioned" } }, false);
        return;
      }
      if (!data.readable) {
        status.textContent = "I couldn't find quote lines in that image. Try a clearer, well-lit photo, or type the lines in.";
        renderConfirm({ lines: [{ description: "" }], gst: { status: "not-mentioned" } }, false);
        return;
      }
      status.textContent = `Read ${data.draft.lines.length} line${data.draft.lines.length === 1 ? "" : "s"}${data.dropped ? ` (${data.dropped} unreadable line${data.dropped === 1 ? "" : "s"} left out)` : ""}. Check every number against the paper, then press Check.`;
      renderConfirm(data.draft, true);
    } catch (err) {
      status.textContent = err.message || "Something went wrong. Please try again.";
    } finally {
      $("quote-file").value = "";
    }
  }

  const numOrEmpty = (v) => (v === undefined || v === null ? "" : String(v));
  function parseNum(text, { int = false } = {}) {
    const t = String(text).trim();
    if (!t) return undefined;
    const r = parseRupees(t);
    if (r !== null) return r;
    const n = Number(t.replace(/[,\s₹]/g, ""));
    if (!Number.isFinite(n) || n < 0) return null;
    return int ? Math.round(n) : n;
  }

  /** The editable table. Nothing is checked until the user confirms these numbers. */
  function renderConfirm(draft, fromAi) {
    const box = $("quote-confirm");
    const line = lineByKey(draftCategory || $("quote-category").value);
    const rows = el("tbody");
    const addRow = (l = {}) => {
      const tr = el("tr", null,
        el("td", null, el("input", { type: "text", "aria-label": "Item", maxlength: "120", value: l.description || "", "data-f": "description" })),
        el("td", null, el("input", { type: "text", inputmode: "decimal", "aria-label": "Quantity", value: numOrEmpty(l.quantity), "data-f": "quantity" })),
        el("td", null, el("input", { type: "text", "aria-label": "Unit", maxlength: "20", value: l.unit || "", "data-f": "unit" })),
        el("td", null, el("input", { type: "text", inputmode: "decimal", "aria-label": "Rate", value: numOrEmpty(l.rate), "data-f": "rate" })),
        el("td", null, el("input", { type: "text", inputmode: "decimal", "aria-label": "Amount", value: numOrEmpty(l.amountINR), "data-f": "amountINR" })),
        el("td", null, el("button", { type: "button", class: "icon-x", "aria-label": "Remove this line", onclick: () => tr.remove() }, "×")));
      rows.append(tr);
    };
    (draft.lines.length ? draft.lines : [{}]).forEach(addRow);

    const f = (id, label, value, attrs = {}) =>
      el("div", { class: "field" }, el("label", { for: id }, label), el("input", { id, type: "text", value: numOrEmpty(value), ...attrs }));
    const gstSel = el("select", { id: "q-gst" },
      el("option", { value: "included" }, "Included in price"),
      el("option", { value: "extra" }, "Extra, on top"),
      el("option", { value: "not-mentioned" }, "Not mentioned"));
    gstSel.value = draft.gst.status;
    const refund = el("input", { id: "q-refund", type: "checkbox" });
    refund.checked = !!draft.refundMentioned;
    const msg = el("p", { class: "booking-msg", role: "alert" });

    const form = el("form", { class: "quote-form" },
      el("p", { class: "booking-title" }, `${fromAi ? "Confirm what Toran read" : "Type the quote"}${line ? ` · ${line.label}` : ""}`),
      fromAi ? el("p", { class: "booking-hint" }, "AI can misread handwriting. Fix anything that doesn't match the paper.") : null,
      f("q-vendor", "Vendor name (as on the quote)", draft.vendorName || prefillVendor, { maxlength: "80" }),
      el("div", { class: "table-scroll" },
        el("table", { class: "quote-table" },
          el("caption", { class: "sr-only" }, "Quote lines"),
          el("thead", null, el("tr", null, ["Item", "Qty", "Unit", "Rate ₹", "Amount ₹", ""].map((h) => el("th", { scope: "col" }, h)))),
          rows)),
      el("button", { type: "button", class: "link-btn", onclick: () => addRow() }, "+ Add a line"),
      el("div", { class: "quote-fields" },
        f("q-subtotal", "Subtotal ₹", draft.subtotalINR, { inputmode: "decimal" }),
        el("div", { class: "field" }, el("label", { for: "q-gst" }, "GST"), gstSel),
        f("q-gstpct", "GST %", draft.gst.ratePct, { inputmode: "decimal", placeholder: "if written" }),
        f("q-gstamt", "GST amount ₹", draft.gst.amountINR, { inputmode: "decimal" }),
        f("q-total", "Total on quote ₹", draft.totalINR, { inputmode: "decimal" }),
        f("q-min", "Minimum guarantee (plates/guests)", draft.minimumGuarantee && draft.minimumGuarantee.quantity, { inputmode: "numeric" }),
        f("q-advpct", "Advance %", draft.advance && draft.advance.percent, { inputmode: "decimal" }),
        f("q-advamt", "Advance ₹", draft.advance && draft.advance.amountINR, { inputmode: "decimal" })),
      el("div", { class: "check-row" }, refund, el("label", { for: "q-refund" }, "Cancellation / refund terms are written on the quote")),
      draft.notes && draft.notes.length ? el("details", { class: "quote-notes" }, el("summary", null, `Terms on the quote (${draft.notes.length})`), el("ul", null, draft.notes.map((n) => el("li", null, n)))) : null,
      msg,
      el("div", { class: "booking-actions" },
        el("button", { type: "submit", class: "btn-primary" }, "Check this quote"),
        el("button", { type: "button", class: "btn-quiet", onclick: () => { box.replaceChildren(); $("quote-status").textContent = ""; } }, "Cancel")));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.textContent = "";
      const lines = [];
      for (const tr of rows.querySelectorAll("tr")) {
        const get = (k) => tr.querySelector(`[data-f="${k}"]`).value;
        const description = get("description").trim();
        const q = parseNum(get("quantity")), r = parseNum(get("rate")), a = parseNum(get("amountINR"), { int: true });
        if (!description && q === undefined && r === undefined && a === undefined) continue;
        if (!description) { msg.textContent = "Every line needs an item name."; return; }
        if (q === null || r === null || a === null) { msg.textContent = `Check the numbers on "${description}".`; return; }
        lines.push({ description, ...(q !== undefined ? { quantity: q } : {}), ...(get("unit").trim() ? { unit: get("unit").trim() } : {}),
          ...(r !== undefined ? { rate: r } : {}), ...(a !== undefined ? { amountINR: Math.round(a) } : {}) });
      }
      if (!lines.length) { msg.textContent = "Add at least one line."; return; }
      const val = (id, opt) => { const v = parseNum($(id).value, opt); if (v === null) throw new Error(id); return v; };
      let quote;
      try {
        const min = val("q-min", { int: true });
        const advPct = val("q-advpct"), advAmt = val("q-advamt", { int: true });
        quote = {
          category: draftCategory || $("quote-category").value,
          ...($("q-vendor").value.trim() ? { vendorName: $("q-vendor").value.trim() } : {}),
          lines,
          ...(val("q-subtotal", { int: true }) !== undefined ? { subtotalINR: val("q-subtotal", { int: true }) } : {}),
          gst: {
            status: gstSel.value,
            ...(val("q-gstpct") !== undefined ? { ratePct: val("q-gstpct") } : {}),
            ...(val("q-gstamt", { int: true }) !== undefined ? { amountINR: val("q-gstamt", { int: true }) } : {}),
          },
          ...(val("q-total", { int: true }) !== undefined ? { totalINR: val("q-total", { int: true }) } : {}),
          ...(min !== undefined && min > 0 ? { minimumGuarantee: { quantity: min } } : {}),
          ...(advPct !== undefined || advAmt !== undefined ? { advance: { ...(advPct !== undefined ? { percent: advPct } : {}), ...(advAmt !== undefined ? { amountINR: advAmt } : {}) } } : {}),
          refundMentioned: refund.checked,
          ...(draft.notes && draft.notes.length ? { notes: draft.notes.slice(0, 20) } : {}),
        };
      } catch {
        msg.textContent = "One of the amounts isn't a number. Please check the fields below the table.";
        return;
      }
      await runQuoteCheck(quote);
    });

    box.replaceChildren(form);
    form.querySelector("input").focus();
  }

  async function runQuoteCheck(quote) {
    const line = lineByKey(quote.category);
    try {
      const r = await api("/api/quote/check", { quote, guestCount: state.plan.input.guestCount, ...(line ? { plannedINR: line.plannedINR } : {}) });
      renderVerdict(quote, r);
      if (quote.vendorName) trackVendorFromQuote(quote.category, quote.vendorName, { status: "quote", minStatus: true, totalINR: r.trueTotalINR });
    } catch (err) {
      const issue = err.data && err.data.issues && err.data.issues[0];
      $("quote-status").textContent = issue ? `Please fix: ${issue.message}` : "Couldn't check this quote. Please try again.";
    }
  }

  const SEV = { problem: ["✗", "Problem"], warning: ["!", "Check"], good: ["✓", "Good"] };

  function renderVerdict(quote, r, savedId) {
    const line = lineByKey(quote.category);
    const box = $("quote-verdict");
    const headline = r.problems
      ? `${r.problems} mistake${r.problems === 1 ? "" : "s"} found`
      : r.warnings ? `${r.warnings} thing${r.warnings === 1 ? "" : "s"} to ask` : "Looks clean";
    const advance = el("input", { id: "book-adv", type: "text", inputmode: "decimal", placeholder: "0 if none yet" });
    const bookMsg = el("p", { class: "booking-msg", role: "alert" });
    const card = el("section", { class: `verdict ${r.problems ? "bad" : r.warnings ? "mid" : "ok"}`, "aria-label": "Quote check result" },
      el("div", { class: "verdict-head" },
        el("div", null,
          el("p", { class: "eyebrow" }, `${quote.vendorName || "Vendor"} · ${line ? line.label : quote.category}`),
          el("p", { class: "verdict-title" }, headline)),
        el("div", { class: "verdict-total" },
          el("span", { class: "k" }, "You'd actually pay"),
          el("strong", null, inr(r.trueTotalINR)),
          r.ifGstExtraINR ? el("span", { class: "s" }, `or ${inr(r.ifGstExtraINR)} if GST is added`) : null,
          r.correctedTotalINR !== null && r.correctedTotalINR !== r.trueTotalINR
            ? el("span", { class: "s fix" }, `${inr(r.correctedTotalINR)} if the mistakes are fixed`) : null)),
      el("ul", { class: "findings" }, r.findings.map((f) =>
        el("li", { class: `finding ${f.severity}` },
          el("span", { class: "sev", "aria-hidden": "true" }, SEV[f.severity][0]),
          el("span", null, el("span", { class: "sr-only" }, SEV[f.severity][1] + ": "), f.message)))),
      r.message ? el("div", { class: "vendor-msg" },
        el("p", { class: "booking-title" }, "Questions for the vendor"),
        el("p", { class: "invitation" }, r.message),
        el("div", { class: "row-actions" },
          el("a", { class: "btn-primary btn-link", href: whatsappUrl(r.message), target: "_blank", rel: "noopener" }, "Send on WhatsApp"),
          el("button", { type: "button", class: "btn-quiet", onclick: (e) => copyText(r.message, e.currentTarget) }, "Copy"))) : null,
      el("div", { class: "row-actions" },
        savedId ? null : el("button", { type: "button", class: "btn-quiet", onclick: (e) => {
          saveQuote(quote, r);
          e.currentTarget.textContent = "Saved to compare";
          e.currentTarget.disabled = true;
        } }, "Save to compare")),
      el("form", { class: "book-form", onsubmit: (e) => {
        e.preventDefault();
        const adv = advance.value.trim() ? parseRupees(advance.value) : 0;
        if (adv === null || adv > r.trueTotalINR) { bookMsg.textContent = "Enter the advance in rupees (not more than the total)."; return; }
        bookVendor(quote, r, adv);
      } },
        el("p", { class: "booking-title" }, `Decided? Book ${quote.vendorName || "this vendor"} for ${inr(r.trueTotalINR)}`),
        el("label", { for: "book-adv" }, "Advance paid"), advance, bookMsg,
        el("button", { type: "submit", class: "btn-primary" }, "Book this vendor")));
    box.replaceChildren(card);
    $("quote-confirm").replaceChildren();
    $("quote-status").textContent = "";
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function saveQuote(quote, r) {
    const id = "q" + Date.now().toString(36);
    state.quotes = [...(state.quotes || []), {
      id, category: quote.category, vendorName: quote.vendorName || "Vendor", quote,
      trueTotalINR: r.trueTotalINR, problems: r.problems, warnings: r.warnings, savedAt: new Date().toISOString().slice(0, 10),
    }].slice(-30);
    save();
    renderSavedQuotes();
    return id;
  }

  /** Records the deal: on the timeline task that books this line (so the task ticks too), else as a line cost. */
  function bookVendor(quote, r, advanceINR) {
    const booking = bookLine(quote.category, { agreedINR: r.trueTotalINR, advanceINR });
    state.quotes = (state.quotes || []).map((q) => (q.category === quote.category ? { ...q, booked: q.vendorName === (quote.vendorName || "Vendor") && q.trueTotalINR === r.trueTotalINR } : q));
    if (quote.vendorName) trackVendorFromQuote(quote.category, quote.vendorName, { status: "confirmed", totalINR: r.trueTotalINR, booking, advanceINR });
    save();
    $("quote-verdict").replaceChildren(el("p", { class: "verdict-done" },
      `Booked ${quote.vendorName || "the vendor"} for ${inr(r.trueTotalINR)}. Your budget and timeline are updated.`));
    refreshPlan();
  }

  function renderSavedQuotes() {
    const box = $("quote-saved");
    const list = state.quotes || [];
    box.replaceChildren();
    if (!list.length) return;
    const byCat = {};
    for (const q of list) (byCat[q.category] = byCat[q.category] || []).push(q);
    box.append(el("h3", { class: "saved-title" }, "Saved quotes"));
    for (const [cat, qs] of Object.entries(byCat)) {
      const line = lineByKey(cat);
      const sorted = [...qs].sort((a, b) => a.trueTotalINR - b.trueTotalINR);
      box.append(el("div", { class: "table-scroll" }, el("table", { class: "compare" },
        el("caption", null, `${line ? line.label : cat}${line ? ` · planned ${inr(line.plannedINR)}` : ""}`),
        el("thead", null, el("tr", null, ["Vendor", "True total", "Issues", ""].map((h) => el("th", { scope: "col" }, h)))),
        el("tbody", null, sorted.map((q, i) => el("tr", { class: q.booked ? "booked" : "" },
          el("th", { scope: "row" }, q.vendorName, i === 0 && sorted.length > 1 ? el("span", { class: "badge good" }, "lowest") : null, q.booked ? el("span", { class: "badge booked" }, "booked") : null),
          el("td", { class: "num" }, inr(q.trueTotalINR)),
          el("td", null, q.problems ? `${q.problems} mistake${q.problems === 1 ? "" : "s"}` : q.warnings ? `${q.warnings} to ask` : "clean"),
          el("td", null,
            el("button", { type: "button", class: "link-btn", onclick: () => { draftCategory = q.category; runQuoteCheck(q.quote); } }, "Open"),
            el("button", { type: "button", class: "link-btn", "aria-label": `Remove ${q.vendorName}`, onclick: () => {
              state.quotes = state.quotes.filter((x) => x.id !== q.id); save(); renderSavedQuotes();
            } }, "Remove"))))))));
    }
  }

  $("quote-file").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; if (f) readQuoteFile(f); });
  $("quote-manual").addEventListener("click", () => {
    draftCategory = $("quote-category").value;
    $("quote-verdict").replaceChildren();
    $("quote-status").textContent = "";
    renderConfirm({ lines: [{}], gst: { status: "not-mentioned" } }, false);
  });

  /* ---------- sharing ---------- */
  const whatsappUrl = (text) => "https://wa.me/?text=" + encodeURIComponent(text);

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      if (button) { const old = button.textContent; button.textContent = "Copied"; setTimeout(() => { button.textContent = old; }, 1500); }
    } catch {
      window.prompt("Copy this:", text);
    }
  }

  // The plan link carries the plan inside the part after "#", which browsers
  // never send to a server. Opening it rebuilds the plan with the calculator.
  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(s) {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  function planLink() {
    const payload = {
      v: 1,
      i: state.planInput,
      d: state.deals || {},
      l: state.lineCosts || {},
      t: Object.keys(state.done || {}).filter((k) => state.done[k]),
      // [category, name, phone, status, amount, booked task or "=line", advance]
      vn: (state.vendorList || []).map((v) => [v.cat, v.name, v.phone || "", v.status, v.agreedINR ?? v.quoteINR ?? 0,
        v.booking ? v.booking.taskId || "=" + v.booking.lineKey : "", v.advanceINR || 0]),
    };
    return `${location.origin}/#p=${b64urlEncode(JSON.stringify(payload))}`;
  }

  function planSummary() {
    const p = state.plan;
    const k = p.input;
    const sp = p.spending;
    const typeLabel = k.eventType === "wedding" ? `${subTypeLabel(k)} wedding` : subTypeLabel(k);
    const next = p.timeline.tasks.filter((t) => !state.done[t.id]).slice(0, 3)
      .map((t) => `• ${t.title} (${t.status === "late" ? "overdue" : "by " + fmtDate(t.dueDate)})`);
    const lines = [
      `*${typeLabel}* · ${fmtDate(k.eventDate)}${k.city ? " · " + k.city : ""}`,
      `${k.guestCount.toLocaleString("en-IN")} guests · Budget ${inr(k.totalBudgetINR)}`,
    ];
    if (sp.bookedCount) lines.push(`Booked so far: ${inr(sp.agreedINR)} (advance paid ${inr(sp.advanceINR)})${sp.overBudgetINR ? ` · over budget by ${inr(sp.overBudgetINR)}` : ""}`);
    if (next.length) lines.push("", "*Next up*", ...next);
    lines.push("", "Full plan: " + planLink(), "", "Made with Toran · every celebration, sorted.");
    return lines.join("\n");
  }

  $("share-wa").addEventListener("click", () => {
    window.open(whatsappUrl(planSummary()), "_blank", "noopener");
  });
  $("copy-link").addEventListener("click", (e) => copyText(planLink(), e.currentTarget));
  $("save-pdf").addEventListener("click", () => window.print());
  // Closed sections don't print, so open them for the PDF and restore afterwards.
  let reopened = [];
  window.addEventListener("beforeprint", () => {
    reopened = [...document.querySelectorAll("details:not([open])")];
    reopened.forEach((d) => { d.open = true; });
  });
  window.addEventListener("afterprint", () => { reopened.forEach((d) => { d.open = false; }); reopened = []; });

  /** Opens a plan from a shared link (#p=...). */
  async function importFromLink() {
    const m = /^#p=([A-Za-z0-9_-]{10,16000})$/.exec(location.hash);
    if (!m) return false;
    history.replaceState(null, "", location.pathname); // keep the plan out of the address bar afterwards
    let payload;
    try { payload = JSON.parse(b64urlDecode(m[1])); } catch { return false; }
    if (!payload || payload.v !== 1 || !payload.i || typeof payload.i !== "object") return false;
    if (state.plan && JSON.stringify(state.planInput) !== JSON.stringify(payload.i)) {
      if (!confirm("Open the shared plan? It will replace the plan saved on this phone.")) return false;
    }
    const pick = (obj) => {
      const out = {};
      if (obj && typeof obj === "object") {
        for (const [id, d] of Object.entries(obj)) {
          if (d && Number.isInteger(d.agreedINR) && Number.isInteger(d.advanceINR)) out[id] = { agreedINR: d.agreedINR, advanceINR: d.advanceINR };
        }
      }
      return out;
    };
    const deals = pick(payload.d);
    const lineCosts = pick(payload.l);
    try {
      // The server re-validates everything; a tampered link just fails.
      const doneIds = (Array.isArray(payload.t) ? payload.t : []).filter((x) => typeof x === "string" && /^[a-z]-[a-z-]{2,20}$/.test(x));
      const plan = await api("/api/plan", { ...payload.i, done: doneIds, deals: [
        ...Object.entries(deals).map(([taskId, d]) => ({ taskId, ...d })),
        ...Object.entries(lineCosts).map(([lineKey, d]) => ({ lineKey, ...d })),
      ] });
      const catKeys = new Set(plan.vendors.map((v) => v.key));
      const vendorList = (Array.isArray(payload.vn) ? payload.vn : []).slice(0, MAX_VENDORS).flatMap((row, i) => {
        if (!Array.isArray(row)) return [];
        const [cat, name, phone, status, amount, ref, adv] = row;
        if (!catKeys.has(cat) || typeof name !== "string" || !name.trim() || !(status in VRANK)) return [];
        const ph = typeof phone === "string" ? cleanPhone(phone) : "";
        const v = { id: "v" + Date.now().toString(36) + i, cat, name: name.trim().slice(0, 60), phone: ph || "", status };
        if (Number.isInteger(amount) && amount > 0) { if (status === "confirmed") v.agreedINR = amount; else v.quoteINR = amount; }
        if (status === "confirmed" && typeof ref === "string") {
          if (ref.startsWith("=") && lineCosts[ref.slice(1)]) v.booking = { lineKey: ref.slice(1) };
          else if (deals[ref]) v.booking = { taskId: ref };
          if (v.booking && Number.isInteger(adv) && adv > 0) v.advanceINR = adv;
        }
        return [v];
      });
      state = { ...fresh(), known: { ...payload.i }, planInput: payload.i, plan, deals, lineCosts, vendorList,
        done: Object.fromEntries(doneIds.map((x) => [x, true])) };
      save();
      renderKnown();
      renderPlan();
      show("plan");
      return true;
    } catch {
      alert("This plan link is damaged or out of date, so it couldn't be opened.");
      return false;
    }
  }

  /* ---------- install / keep data safe ---------- */
  let installEvent = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e;
    $("install-btn").hidden = false;
    updateInstall();
  });
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function updateInstall() {
    let dismissed = false;
    try { dismissed = localStorage.getItem("toran.installDismissed") === "1"; } catch { /* ignore */ }
    const show = !!state.plan && !isStandalone() && !dismissed;
    $("install").hidden = !show;
    if (!show) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!installEvent) {
      $("install-text").textContent = ios
        ? "Your plan is saved on this phone. To keep it one tap away, tap the Share button in Safari, then \"Add to Home Screen\"."
        : "Your plan is saved on this phone. To keep it one tap away, open your browser menu (⋮) and choose \"Add to Home screen\" or \"Install app\".";
    }
  }
  window.addEventListener("appinstalled", () => {
    $("install").hidden = false;
    $("install-title").textContent = "Toran is installed";
    $("install-text").textContent = "Look for the Toran icon on your home screen or in your app drawer (swipe up). On some phones, including Xiaomi, Oppo, Vivo and Realme, the icon only appears on the home screen after you allow it: Settings → Apps → Chrome → Permissions → \"Home screen shortcuts\".";
    $("install-btn").hidden = true;
    $("install-dismiss").textContent = "Got it";
  });
  $("install-btn").addEventListener("click", async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => null);
    installEvent = null;
    $("install-btn").hidden = true;
    updateInstall();
  });
  $("install-dismiss").addEventListener("click", () => {
    try { localStorage.setItem("toran.installDismissed", "1"); } catch { /* ignore */ }
    $("install").hidden = true;
  });
  // Ask the browser not to clear our storage under pressure (granted automatically for installed apps).
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }

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
    state = fresh();
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
  if (state.plan && !state.plan.spending) { state.plan = null; } // plan saved by an older version
  function restore() {
    if (state.plan) {
      renderPlan();
      show("plan");
      // Recalculate on every open (no AI): keeps "days to go" and late tasks current,
      // and applies engine fixes and warnings to plans saved by older versions.
      refreshPlan();
    }
    else if (state.chat.length) { show("interview"); turn({}); }
  }
  if (/^#p=/.test(location.hash)) importFromLink().then((opened) => { if (!opened) restore(); });
  else restore();
})();
