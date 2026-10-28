/*
 * Toran front end · State kept in this browser, and calls to our API.
 * Every piece of text is inserted with textContent (never innerHTML).
 */

export const STORE_KEY = "toran.v1";
export const MIN_GAP_MS = 2000; // throttle for anything that can trigger an AI call
/* ---------- state ---------- */
export const state = load() || fresh();
export function fresh() {
  return {
    known: {},
    guessed: [],
    planInput: null,
    plan: null,
    done: {},
    deals: {},
    lineCosts: {},
    quotes: [],
    vendorList: [],
    ideas: null,
    chat: [],
  };
}
export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    return s && typeof s === "object" ? { ...fresh(), ...s } : null;
  } catch {
    return null;
  }
}
/** Replaces everything in the shared state object (modules hold a reference to it). */
export function replaceState(next) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, next);
}
export function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* storage may be blocked; app still works */
  }
}

/* ---------- network ---------- */
export let lastAiCall = 0;
/** Waits so AI-triggering calls are at least MIN_GAP_MS apart. */
export async function waitForAiSlot() {
  const wait = lastAiCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAiCall = Date.now();
}
export async function api(path, body, { ai = false } = {}) {
  if (ai) await waitForAiSlot();
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { data, status: res.status });
  return data;
}
