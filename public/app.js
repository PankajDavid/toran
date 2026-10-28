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
  function fresh() { return { known: {}, guessed: [], planInput: null, plan: null, done: {}, deals: {}, lineCosts: {}, ideas: null, chat: [] }; }
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

  /** Re-runs the calculator (no AI) after a booking changes. */
  async function refreshPlan() {
    try {
      state.plan = await api("/api/plan", { ...state.planInput, deals: dealList() });
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
      const plan = await api("/api/plan", { ...planInput, deals: dealList() });
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
        else if (value && value.agreedINR > 0) state.lineCosts[f.id] = value;
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
          state.done[task.id] = true;
          save();
          renderPlan();
        } }, "Just mark done"),
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
        tile("Still to book", inr(sp.unbookedPlannedINR), "estimated"),
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
        el("th", { scope: "row" }, l.label, l.booked ? el("span", { class: "badge booked" }, "booked") : null, note, bar, costBtn),
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
        renderPlan();
      });
      const when = t.status === "late" ? `Ideally by ${fmtDate(t.idealDate)} · do it now` : `By ${fmtDate(t.dueDate)}`;
      li.append(box,
        el("label", { for: id }, t.title,
          !done && t.status !== "upcoming" ? el("span", { class: `badge ${t.status}` }, t.status === "late" ? "late" : "this week") : null,
          el("span", { class: "when" }, deal ? `Booked for ${inr(deal.agreedINR)} · advance ${inr(deal.advanceINR)}` : when)));
      return li;
    }));

    // Vendors
    $("vendors").replaceChildren(...p.vendors.map((v) =>
      el("details", { class: "vendor" }, el("summary", null, v.category), el("ul", null, v.questions.map((q) => el("li", null, q))))));

    renderIdeas();
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
    const m = /^#p=([A-Za-z0-9_-]{10,6000})$/.exec(location.hash);
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
      const plan = await api("/api/plan", { ...payload.i, deals: [
        ...Object.entries(deals).map(([taskId, d]) => ({ taskId, ...d })),
        ...Object.entries(lineCosts).map(([lineKey, d]) => ({ lineKey, ...d })),
      ] });
      state = { ...fresh(), known: { ...payload.i }, planInput: payload.i, plan, deals, lineCosts,
        done: Object.fromEntries((Array.isArray(payload.t) ? payload.t : []).filter((x) => typeof x === "string").map((x) => [x, true])) };
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
