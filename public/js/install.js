/*
 * Toran front end · Install to home screen and keeping data safe.
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $ } from "./dom.js";
import { state } from "./store.js";

/* ---------- install / keep data safe ---------- */
export let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  $("install-btn").hidden = false;
  updateInstall();
});
export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export function updateInstall() {
  let dismissed = false;
  try {
    dismissed = localStorage.getItem("toran.installDismissed") === "1";
  } catch {
    /* ignore */
  }
  // Only on phones/tablets: that's where browsers clear storage and a home-screen icon helps.
  const phone = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) <= 900;
  const show = !!state.plan && phone && !isStandalone() && !dismissed;
  $("install").hidden = !show;
  if (!show) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!installEvent) {
    $("install-text").textContent = ios
      ? 'Your plan is saved on this phone. To keep it one tap away, tap the Share button in Safari, then "Add to Home Screen".'
      : 'Your plan is saved on this phone. To keep it one tap away, open your browser menu (⋮) and choose "Add to Home screen" or "Install app".';
  }
}
window.addEventListener("appinstalled", () => {
  $("install").hidden = false;
  $("install-title").textContent = "Toran is installed";
  $("install-text").textContent =
    'Look for the Toran icon on your home screen or in your app drawer (swipe up). On some phones, including Xiaomi, Oppo, Vivo and Realme, the icon only appears on the home screen after you allow it: Settings → Apps → Chrome → Permissions → "Home screen shortcuts".';
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
  try {
    localStorage.setItem("toran.installDismissed", "1");
  } catch {
    /* ignore */
  }
  $("install").hidden = true;
});
// Ask the browser not to clear our storage under pressure (granted automatically for installed apps).
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
