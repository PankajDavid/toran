/*
 * Toran front end · The planning interview: chat, quick answers, voice input.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, button, el, field, show } from "./dom.js";
import { describeField, FIELD_ORDER, fmtDate } from "./format.js";
import { api, save, state } from "./store.js";
import { buildPlan } from "./plan.js";

/* ---------- interview ---------- */
export let current = null; // the question being asked
export let multi = new Set(); // ticked options for a multi-select question
export let busy = false;

export function addMsg(who, text, extraClass) {
  state.chat.push({ who, text });
  if (state.chat.length > 60) state.chat.splice(0, state.chat.length - 60);
  renderMsg(who, text, extraClass);
  save();
}
export function renderMsg(who, text, extraClass) {
  const chat = $("chat");
  const node = el("div", { class: `msg ${who}${extraClass ? ` ${extraClass}` : ""}` }, text);
  chat.append(node);
  node.scrollIntoView({ block: "end", behavior: "smooth" });
  return node;
}

export function renderKnown() {
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
    list.append(
      el(
        "li",
        null,
        el(
          "button",
          {
            type: "button",
            class: guess ? "guess" : "",
            "aria-label": `${label}${guess ? " (my guess)" : ""}. Tap to change`,
            onclick: () => changeField(f),
          },
          label + (guess ? " · guess" : ""),
        ),
      ),
    );
  }
  $("known-hint").hidden = !anyGuess;
}

export function renderQuestion(q) {
  current = q;
  multi = new Set();
  const chips = $("chips");
  chips.replaceChildren();
  const say = field("say");
  const date = field("date");
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
        if (multi.has(value)) multi.delete(value);
        else multi.add(value);
        chip.setAttribute("aria-pressed", String(multi.has(value)));
      });
      chips.append(chip);
    } else {
      chips.append(el("button", { type: "button", class: "chip", onclick: () => turn({ set: opt.set }, opt.label) }, opt.label));
    }
  }
  if (q.mode === "multi") {
    chips.append(
      el(
        "button",
        {
          type: "button",
          class: "btn-primary",
          onclick: () => {
            if (!multi.size) {
              $("mic-status").textContent = "Tick at least one, then press Done.";
              return;
            }
            const picked = [...multi];
            turn({ set: { subEvents: picked } }, picked.map((s) => s[0].toUpperCase() + s.slice(1)).join(", "));
          },
        },
        "Done",
      ),
    );
  }
}

export function askCurrent(q) {
  if (q) addMsg("toran", q.text);
  renderQuestion(q);
}

export async function turn(payload, echo) {
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
        addMsg(
          "toran",
          "Noted: " +
            noted
              .map((f) => describeField(f, r.known))
              .filter(Boolean)
              .join(" · "),
        );
      }
      if (r.planInput) await buildPlan(r.planInput);
      else askCurrent(r.next);
    }
  } catch (err) {
    thinking.remove();
    addMsg(
      "toran",
      err.status === 429
        ? "That's a lot of messages quickly. Please wait a minute and try again."
        : "Something went wrong on my side. Please try again.",
    );
    renderQuestion(current);
  } finally {
    busy = false;
    setBusy(false);
  }
}

export function setBusy(on) {
  button("send").disabled = on;
  for (const b of $("chips").querySelectorAll("button")) b.disabled = on;
}

export function changeField(field) {
  const k = { ...state.known };
  delete k[field];
  if (field === "eventType") {
    delete k.subType;
    delete k.subEvents;
  }
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
  const text = field("say").value.trim();
  const date = field("date");
  if (current && current.input === "date" && date.value) {
    const v = date.value;
    date.value = "";
    turn({ set: { eventDate: v } }, fmtDate(v));
    return;
  }
  if (!text) return;
  field("say").value = "";
  turn({ text }, text);
});

/* ---------- voice input (browser speech recognition) ---------- */
// Speech recognition is still vendor-prefixed in Chrome and isn't in the standard DOM types.
export const speechWindow = /** @type {Window & { SpeechRecognition?: any; webkitSpeechRecognition?: any }} */ (window);
export const Speech = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
if (Speech) {
  const mic = $("mic");
  mic.hidden = false;
  let rec = null;
  mic.addEventListener("click", () => {
    if (rec) {
      rec.stop();
      return;
    }
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
        if (ev.results[i].isFinal) finalText += t;
        else interim += t;
      }
      field("say").value = (finalText + interim).slice(0, 500);
    };
    rec.onerror = (ev) => {
      $("mic-status").textContent =
        ev.error === "not-allowed" ? "Microphone access was blocked. You can type instead." : "I couldn't hear that. Try again or type.";
    };
    rec.onend = () => {
      mic.setAttribute("aria-pressed", "false");
      rec = null;
      const text = field("say").value.trim();
      if (text) {
        $("mic-status").textContent = "";
        field("say").value = "";
        turn({ text }, text);
      } else if (!$("mic-status").textContent.startsWith("Microphone")) {
        $("mic-status").textContent = "";
      }
    };
    rec.start();
  });
}
