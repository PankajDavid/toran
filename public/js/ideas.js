/*
 * Toran front end · Ideas, invitation wording and tips (one AI call fills all three).
 * Every piece of text is inserted with textContent (never innerHTML).
 */
import { $, button, el, field } from "./dom.js";
import { api, save, state } from "./store.js";
import { renderNav } from "./nav.js";
import { copyText, whatsappUrl } from "./share.js";

/* ---------- ideas ---------- */
export function renderIdeas() {
  const box = $("ideas");
  box.replaceChildren();
  const r = state.ideas;
  $("get-ideas").hidden = !!r;
  $("refine").hidden = !r;
  $("get-invitation").hidden = !!r;
  $("get-tips").hidden = !!r;
  $("invitation").replaceChildren();
  $("tips").replaceChildren();
  if (!r) return;
  const i = r.ideas;
  if (i.themes.length) {
    box.append(
      el(
        "div",
        { class: "ideas-block" },
        el("h3", null, "Themes"),
        i.themes.map((t) =>
          el(
            "div",
            { class: "theme" },
            el("strong", null, t.name),
            t.colours.length
              ? el(
                  "div",
                  { class: "swatches" },
                  t.colours.map((c) => el("span", { class: "swatch" }, c)),
                )
              : null,
            t.description,
          ),
        ),
      ),
    );
  }
  if (i.decor.length)
    box.append(
      el(
        "div",
        { class: "ideas-block" },
        el("h3", null, "Decor"),
        el(
          "ul",
          null,
          i.decor.map((d) => el("li", null, d)),
        ),
      ),
    );
  if (i.menu.length) {
    box.append(
      el(
        "div",
        { class: "ideas-block" },
        el("h3", null, "Menu"),
        i.menu.map((c) =>
          el(
            "div",
            null,
            el("strong", null, c.course),
            el(
              "ul",
              null,
              c.items.map((x) => el("li", null, x)),
            ),
          ),
        ),
      ),
    );
  }
  if (i.invitation) {
    $("invitation").append(
      el(
        "div",
        { class: "ideas-block" },
        el("p", { class: "invitation" }, i.invitation),
        el(
          "div",
          { class: "row-actions" },
          el(
            "a",
            { class: "btn-primary btn-link", href: whatsappUrl(i.invitation), target: "_blank", rel: "noopener" },
            "Send on WhatsApp",
          ),
          el("button", { type: "button", class: "btn-quiet", onclick: (e) => copyText(i.invitation, e.currentTarget) }, "Copy"),
        ),
      ),
    );
  }
  if (i.tips.length)
    $("tips").append(
      el(
        "ul",
        { class: "tips-list" },
        i.tips.map((t) => el("li", null, t)),
      ),
    );
  else $("tips").append(el("p", { class: "source-note" }, "No tips this time. Try refining in Ideas."));
  if (!i.invitation) $("invitation").append(el("p", { class: "source-note" }, "No invitation wording this time. Try refining in Ideas."));
  const notes = [];
  if (r.source === "offline") notes.push("These come from our curated set because the AI is offline right now.");
  if (r.removed)
    notes.push(
      `${r.removed} AI suggestion${r.removed === 1 ? " was" : "s were"} removed by our checks (prices, or food that doesn't fit your diet).`,
    );
  if (notes.length) box.append(el("p", { class: "source-note" }, notes.join(" ")));
}

export const IDEA_BUTTONS = [
  ["get-ideas", "Get ideas"],
  ["get-invitation", "Write my invitation"],
  ["get-tips", "Get tips"],
];
export async function loadIdeas(refine) {
  // One AI call makes ideas, invitation and tips together; every button shows it working.
  for (const [id] of IDEA_BUTTONS) {
    button(id).disabled = true;
    $(id).textContent = "Working on it… (about 10 seconds)";
  }
  const box = $("ideas");
  if (refine) box.prepend(el("p", { class: "source-note" }, "Refining…"));
  try {
    state.ideas = await api("/api/ideas", { plan: state.planInput, ...(refine ? { refine } : {}) }, { ai: true });
    save();
  } catch (err) {
    box.prepend(
      el(
        "p",
        { class: "warning" },
        err.status === 429 ? "Too many requests. Please wait a minute." : "Couldn't get ideas just now. Please try again.",
      ),
    );
  } finally {
    for (const [id, label] of IDEA_BUTTONS) {
      button(id).disabled = false;
      $(id).textContent = label;
    }
    renderIdeas();
    renderNav();
  }
}
$("get-ideas").addEventListener("click", () => loadIdeas());
$("get-invitation").addEventListener("click", () => loadIdeas());
$("get-tips").addEventListener("click", () => loadIdeas());
$("refine").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = field("refine-text").value.trim();
  if (t) loadIdeas(t);
});
