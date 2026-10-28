import { expect, type Page } from "@playwright/test";

/** Plans a Punjabi wedding from one Hinglish sentence plus one tap, and waits for the plan. */
export async function makePlan(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Let's plan" }).click();
  await page.locator("#chips .chip").first().waitFor();
  await page.locator("#say").fill("beti ki shaadi 14 feb, 250 log, 20 lakh, Ludhiana, pure veg");
  await page.locator("#send").click();
  await page.locator("#chips .chip", { hasText: "Ceremony" }).click();
  await page.locator("#chips .btn-primary", { hasText: "Done" }).click();
  await expect(page.locator("#plan")).toBeVisible();
  await expect(page.locator("#plan-title")).toContainText("Punjabi wedding");
  // Let the "plan ready" animation finish so it doesn't cover the page.
  await expect(page.locator("#ready")).toBeHidden({ timeout: 8000 });
}

export const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });

export const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("toran.v1") || "{}"));

/** Opens one vendor category in the Vendors section. */
export async function openVendor(page: Page, category: string) {
  await tab(page, "Vendors").click();
  const cat = page.locator("details.vendor").filter({ has: page.locator("summary .v-cat", { hasText: new RegExp(`^${category}$`) }) });
  if (!(await cat.evaluate((d) => (d as HTMLDetailsElement).open))) await cat.locator("summary").click();
  return cat;
}

/** Types a one-line caterer quote into the Quote Checker and runs the checks. */
export async function typeQuote(page: Page, vendor: string, plates: number, rate: number, amount: number) {
  await tab(page, "Quote Checker").click();
  await page.locator("#quote-category").selectOption("catering");
  await page.getByRole("button", { name: "Type it in instead" }).click();
  await page.locator("#q-vendor").fill(vendor);
  const cells = page.locator(".quote-form input:not([id])");
  await cells.nth(0).fill("Veg buffet per plate");
  await cells.nth(1).fill(String(plates));
  await cells.nth(2).fill("plate");
  await cells.nth(3).fill(String(rate));
  await cells.nth(4).fill(String(amount));
  await page.locator(".quote-form button[type=submit]").click();
  await expect(page.locator(".verdict")).toBeVisible();
}
