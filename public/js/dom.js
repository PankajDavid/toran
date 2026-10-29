/*
 * Toran front end · DOM helpers and screen switching.
 * Every piece of text is inserted with textContent (never innerHTML).
 */

/** An element by id. @param {string} id @returns {HTMLElement} */
export const $ = (id) => document.getElementById(id);

/** A form field by id (input, select or textarea). @param {string} id */
export const field = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

/** A button by id. @param {string} id */
export const button = (id) => /** @type {HTMLButtonElement} */ (document.getElementById(id));

/**
 * Builds an element. Text children become text nodes, so nothing is ever parsed as HTML.
 * Attributes starting with "on" become event listeners; false, null and undefined are skipped.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, any> | null} [attrs]
 * @param {...any} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, attrs, ...children) {
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

/** Set on the first tap or key press: until then the page is just opening, and focus is left alone. */
let interacted = false;
for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, () => (interacted = true), { once: true, capture: true });

/**
 * Shows one of the three screens. After the user has done something, focus moves to the new screen's
 * heading unless it is already inside that screen, so keyboard and screen-reader users land at its start
 * instead of on a control that just disappeared.
 * @param {"welcome" | "interview" | "plan"} screen
 */
export function show(screen) {
  for (const id of ["welcome", "interview", "plan"]) $(id).hidden = id !== screen;
  $("restart").hidden = screen === "welcome";
  window.scrollTo({ top: 0 });
  const heading = $(screen).querySelector("h1");
  if (heading && interacted && !$(screen).contains(document.activeElement)) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}
