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
  function fresh() { return { known: {}, guessed: [], planInput: null, plan: null, done: {}, ideas: null, chat: [] }; }
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
  async function buildPlan(planInput) {
    try {
      const plan = await api("/api/plan", planInput);
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

    // Budget
    $("budget-sub").textContent = `${inr(p.budget.perGuestINR)} per guest · food ${inr(p.budget.foodPerGuestINR)} per guest`;
    const maxBp = Math.max(...p.budget.lines.map((l) => l.bp));
    $("budget-rows").replaceChildren(...p.budget.lines.map((l) => {
      const bar = el("span", { class: "bar", "aria-hidden": "true" });
      bar.style.width = `${Math.max(3, (l.bp / maxBp) * 100)}%`; // biggest line fills the cell
      return el("tr", null,
        el("th", { scope: "row" }, l.label, bar),
        el("td", { class: "num" }, inr(l.amountINR)),
        el("td", { class: "num" }, pct(l.bp)));
    }));
    $("budget-total").textContent = inr(p.budget.totalINR);

    // Timeline
    const doneCount = p.timeline.tasks.filter((t) => state.done[t.id]).length;
    $("timeline-sub").textContent = `${doneCount} of ${p.timeline.tasks.length} done${p.timeline.lateCount ? ` · ${p.timeline.lateCount} behind schedule` : ""}`;
    $("tasks").replaceChildren(...p.timeline.tasks.map((t) => {
      const id = `task-${t.id}`;
      const done = !!state.done[t.id];
      const box = el("input", { type: "checkbox", id });
      box.checked = done;
      box.addEventListener("change", () => {
        state.done[t.id] = box.checked;
        save();
        renderPlan();
      });
      const when = t.status === "late" ? `Ideally by ${fmtDate(t.idealDate)} · do it now` : `By ${fmtDate(t.dueDate)}`;
      return el("li", { class: `task${done ? " done" : ""}` }, box,
        el("label", { for: id }, t.title,
          !done && t.status !== "upcoming" ? el("span", { class: `badge ${t.status}` }, t.status === "late" ? "late" : "this week") : null,
          el("span", { class: "when" }, when)));
    }));

    // Vendors
    $("vendors").replaceChildren(...p.vendors.map((v) =>
      el("details", { class: "vendor" }, el("summary", null, v.category), el("ul", null, v.questions.map((q) => el("li", null, q))))));

    renderIdeas();
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
    if (i.invitation) box.append(el("div", { class: "ideas-block" }, el("h3", null, "Invitation wording"), el("p", { class: "invitation" }, i.invitation)));
    if (i.tips.length) box.append(el("div", { class: "ideas-block" }, el("h3", null, "Tips"), el("ul", null, i.tips.map((t) => el("li", null, t)))));
    const notes = [];
    if (r.source === "offline") notes.push("These come from our curated set because the AI is offline right now.");
    if (r.removed) notes.push(`${r.removed} AI suggestion${r.removed === 1 ? " was" : "s were"} removed by our checks (prices, or food that doesn't fit your diet).`);
    if (notes.length) box.append(el("p", { class: "source-note" }, notes.join(" ")));
  }

  async function loadIdeas(refine) {
    const btn = $("get-ideas");
    btn.disabled = true;
    btn.textContent = "Thinking up ideas…";
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
  if (state.plan) { renderPlan(); show("plan"); }
  else if (state.chat.length) { show("interview"); turn({}); }
})();
