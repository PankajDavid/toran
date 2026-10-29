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

test("no horizontal scrolling on any section, including the quote table and vendor results", async ({ page }) => {
  await makePlan(page);
  // clientWidth is the screen; scrollWidth grows if anything sticks out. (innerWidth grows too on phones.)
  const fits = async (label: string) => {
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll, label).toBeLessThanOrEqual(client);
  };
  for (const name of ["Budget", "Timeline", "Vendors", "Quote Checker", "Ideas", "Invitation", "Tips"]) {
    await tab(page, name).click();
    await fits(name);
  }
  await tab(page, "Quote Checker").click();
  await page.getByRole("button", { name: "Type it in instead" }).click();
  await fits("quote confirm table");
  await tab(page, "Vendors").click();
  const cat = page.locator("details.vendor").filter({ has: page.locator("summary .v-cat", { hasText: /^Caterer$/ }) });
  await cat.locator("summary").click();
  await cat.getByRole("button", { name: "Search", exact: true }).click();
  await cat.locator(".v-found-item").first().waitFor();
  await fits("vendor search results");
});

test("accessibility: axe finds no WCAG 2.2 AA or best-practice problems on any screen or state", async ({ browser }) => {
  test.setTimeout(120_000); // 13 full scans
  // axe is injected as a script, which our own Content Security Policy rightly blocks; bypass it for the test only.
  const page = await (await browser.newContext({ bypassCSP: true })).newPage();
  const axe = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
  const scan = async (label: string) => {
    await page.addScriptTag({ content: axe });
    const violations = await page.evaluate(async () => {
      const w = window as unknown as {
        axe: { run: (ctx: Document, o: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> };
      };
      const r = await w.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] });
      return r.violations.map(
        (v) =>
          `${v.id}: ${v.nodes
            .map((n) => n.target.join(" "))
            .slice(0, 3)
            .join(", ")}`,
      );
    });
    expect(violations, label).toEqual([]);
  };
  await page.goto("/");
  await scan("welcome");
  await page.getByRole("button", { name: "Let's plan" }).click();
  await page.locator("#chips .chip").first().waitFor();
  await scan("interview");
  await page.evaluate(() => localStorage.clear());
  await makePlan(page);
  for (const name of ["Budget", "Timeline", "Vendors", "Quote Checker", "Ideas", "Invitation", "Tips"]) {
    await tab(page, name).click();
    await scan(name);
  }
  // Interactive states: an open vendor category with search results, a booking form, a quote verdict.
  await tab(page, "Vendors").click();
  const cat = page.locator("details.vendor").filter({ has: page.locator("summary .v-cat", { hasText: /^Caterer$/ }) });
  await cat.locator("summary").click();
  await cat.getByRole("button", { name: "Search", exact: true }).click();
  await cat.locator(".v-found-item").first().waitFor();
  await scan("vendor search results");
  await tab(page, "Timeline").click();
  await page.locator('label[for="task-w-venue"]').click();
  await scan("booking form");
  await tab(page, "Quote Checker").click();
  await page.getByRole("button", { name: "Type it in instead" }).click();
  await scan("quote confirm table");
  const cells = page.locator(".quote-form input:not([id])");
  await cells.nth(0).fill("Veg buffet per plate");
  await cells.nth(1).fill("250");
  await cells.nth(3).fill("650");
  await cells.nth(4).fill("172500");
  await page.locator(".quote-form button[type=submit]").click();
  await page.locator(".verdict").waitFor();
  await scan("quote verdict");
});

test("keyboard focus: a new screen starts at its heading; opening the page doesn't move focus", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Let's plan" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#interview-title")).toBeFocused();
  await page.reload();
  await expect(page.locator("#interview")).toBeVisible();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test("keyboard focus: the plan starts at its title, and the hidden upload input shows focus on its button", async ({ page }) => {
  await makePlan(page);
  await expect(page.locator("#plan-title")).toBeFocused();
  await tab(page, "Quote Checker").click();
  await page.locator("#quote-category").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#quote-file")).toBeFocused();
  const outline = (sel: string) => page.locator(sel).evaluate((e) => getComputedStyle(e).outlineStyle);
  expect(await outline('label[for="quote-file"]')).toBe("solid");
  expect(await outline("#quote-manual")).toBe("none"); // the button next to it is not the one focused
});
