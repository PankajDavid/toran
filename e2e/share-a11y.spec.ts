import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { makePlan, tab } from "./helpers";

test("a backup file restores the whole plan in a fresh browser", async ({ page, browser }) => {
  await makePlan(page);
  await tab(page, "Timeline").click();
  await page.locator('label[for="task-w-venue"]').click();
  await page.locator("#agreed-w-venue").fill("4,00,000");
  await page.getByRole("button", { name: "Save booking" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Backup", exact: true }).click();
  const path = await (await download).path();

  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto("/");
  await fresh.locator("#restore-file").setInputFiles(path);
  await expect(fresh.locator("#plan-title")).toContainText("Punjabi wedding");
  await expect(tab(fresh, "Budget")).toContainText("₹4,00,000 booked");
});

test("a file that isn't a Toran backup is refused", async ({ page }) => {
  await page.goto("/");
  const dialog = page.waitForEvent("dialog");
  await page.locator("#restore-file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  const d = await dialog;
  expect(d.message()).toBe("That isn't a Toran backup file.");
  await d.dismiss();
});

test("the plan link opens the same plan on another device", async ({ page, browser }) => {
  await makePlan(page);
  await page.evaluate(() => {
    (window as unknown as { __clip: string }).__clip = "";
    navigator.clipboard.writeText = async (t: string) => {
      (window as unknown as { __clip: string }).__clip = t;
    };
  });
  await page.getByRole("button", { name: "Copy plan link" }).click();
  await expect(page.locator("#share-note")).toBeVisible();
  const link = await page.evaluate(() => (window as unknown as { __clip: string }).__clip);
  expect(link).toMatch(/#p=[A-Za-z0-9_-]+$/);
  const other = await (await browser.newContext()).newPage();
  await other.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await expect(other.locator("#plan-title")).toContainText("Punjabi wedding");
});

test("no horizontal scrolling on any section", async ({ page }) => {
  await makePlan(page);
  for (const name of ["Budget", "Timeline", "Vendors", "Quote Checker", "Ideas", "Invitation", "Tips"]) {
    await tab(page, name).click();
    const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(scroll, name).toBeLessThanOrEqual(width);
  }
});

test("accessibility: axe finds no WCAG 2.1 AA problems on any screen", async ({ browser }) => {
  // axe is injected as a script, which our own Content Security Policy rightly blocks; bypass it for the test only.
  const page = await (await browser.newContext({ bypassCSP: true })).newPage();
  const axe = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
  const scan = async (label: string) => {
    await page.addScriptTag({ content: axe });
    const violations = await page.evaluate(async () => {
      const w = window as unknown as { axe: { run: (ctx: Document, o: object) => Promise<{ violations: { id: string }[] }> } };
      return (await w.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map((v) => v.id);
    });
    expect(violations, label).toEqual([]);
  };
  await page.goto("/");
  await scan("welcome");
  await makePlan(page);
  for (const name of ["Budget", "Timeline", "Vendors", "Quote Checker", "Ideas", "Invitation", "Tips"]) {
    await tab(page, name).click();
    await scan(name);
  }
});
