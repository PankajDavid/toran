/*
 * Toran front end · Backup and restore file, calendar file.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, el } from "./dom.js";
import { save, state } from "./store.js";
import { doneList } from "./plan.js";
import { openPayload, planPayload } from "./share.js";
import { renderSuggestions } from "./suggest.js";

/* ---------- backup file & calendar file ---------- */
export function downloadFile(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function backupPlan() {
  const quotes = (state.quotes || []).slice(-30);
  const data = { app: "toran", savedAt: new Date().toISOString(), ...planPayload(), q: quotes };
  downloadFile(
    `toran-backup-${new Date().toISOString().slice(0, 10)}.json`,
    new Blob([JSON.stringify(data)], { type: "application/json" }),
  );
  state.backupSig = backupSignature();
  save();
}
export const backupSignature = () =>
  JSON.stringify([state.deals, state.lineCosts, (state.vendorList || []).length, Object.keys(state.done || {}).length]);

/** Saved quotes from a backup: only well-formed entries; the quote itself is re-checked by the server when opened. */
export function pickQuotes(list) {
  return (Array.isArray(list) ? list : [])
    .slice(-30)
    .filter(
      (q) =>
        q &&
        typeof q === "object" &&
        typeof q.id === "string" &&
        typeof q.category === "string" &&
        typeof q.vendorName === "string" &&
        Number.isInteger(q.trueTotalINR) &&
        Number.isInteger(q.problems) &&
        Number.isInteger(q.warnings) &&
        q.quote &&
        typeof q.quote === "object",
    )
    .map((q) => ({
      id: q.id.slice(0, 20),
      category: q.category.slice(0, 30),
      vendorName: q.vendorName.slice(0, 80),
      quote: q.quote,
      trueTotalINR: q.trueTotalINR,
      problems: q.problems,
      warnings: q.warnings,
      savedAt: String(q.savedAt || "").slice(0, 10),
      booked: q.booked === true,
    }));
}
export async function restoreFrom(file) {
  if (!file) return;
  if (file.size > 400_000) {
    alert("That file is too big to be a Toran backup.");
    return;
  }
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    data = null;
  }
  if (data?.app !== "toran" || data.v !== 1 || !data.i) {
    alert("That isn't a Toran backup file.");
    return;
  }
  if (state.plan && !confirm("Restore this backup? It will replace the plan saved on this device.")) return;
  const ok = await openPayload(data, "This backup is damaged or from an older version, so it couldn't be restored.", {
    quotes: pickQuotes(data.q),
    backupSig: "",
  });
  if (ok) {
    state.backupSig = backupSignature();
    save();
  }
}
export async function downloadCalendar(button) {
  try {
    const res = await fetch("/api/calendar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...state.planInput, done: doneList() }),
    });
    if (!res.ok) throw new Error("calendar");
    downloadFile("toran-plan.ics", await res.blob());
    state.calendarSig = calendarSignature();
    save();
    renderSuggestions();
    return true;
  } catch {
    if (button) button.textContent = "Couldn't make the file. Try again";
    return false;
  }
}
export const calendarSignature = () => JSON.stringify(state.planInput); // re-offer only if the event itself changes
$("restore-file").addEventListener("change", (e) => {
  restoreFrom(e.target.files?.[0]);
  e.target.value = "";
});
$("restore-file-plan").addEventListener("change", (e) => {
  restoreFrom(e.target.files?.[0]);
  e.target.value = "";
});
$("backup-btn").addEventListener("click", () => {
  backupPlan();
  renderSuggestions();
});
$("calendar-btn").addEventListener("click", (e) => downloadCalendar(e.currentTarget));
