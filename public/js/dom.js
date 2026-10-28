/*
 * Toran front end · DOM helpers and screen switching.
 * Every piece of text is inserted with textContent (never innerHTML).
 */

export const $ = (id) => document.getElementById(id);
/* ---------- tiny DOM helper ---------- */
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

/* ---------- screens ---------- */
export function show(screen) {
  for (const id of ["welcome", "interview", "plan"]) $(id).hidden = id !== screen;
  $("restart").hidden = screen === "welcome";
  window.scrollTo({ top: 0 });
}
