import { expect, test } from "@playwright/test";
import { makePlan, saved, tab } from "./helpers";

test("a Hinglish sentence becomes an exact plan", async ({ page }) => {
  await makePlan(page);
  await expect(page.locator("#plan-meta")).toContainText("250 guests · ₹20,00,000 · Ludhiana");
  // The budget lines add up to the exact total.
  const amounts = await page.locator("#budget-rows tr td.num:not(.share)").allInnerTexts();
  const sum = amounts.map((a) => Number(a.replace(/[^\d]/g, ""))).reduce((x, y) => x + y, 0);
  expect(sum).toBe(20_00_000);
  await expect(page.locator("#budget-total")).toHaveText("₹20,00,000");
});

test("one section at a time, with live status, keyboard tabs and a remembered choice", async ({ page }) => {
  await makePlan(page);
  await expect(page.locator("#budget-card")).toBeVisible();
  await expect(page.locator("#timeline-card")).toBeHidden();
  await expect(tab(page, "Timeline")).toContainText("late");
  await tab(page, "Timeline").click();
  await expect(page.locator("#timeline-card")).toBeVisible();
  await expect(page.locator("#budget-card")).toBeHidden();
  await tab(page, "Timeline").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Vendors")).toBeFocused();
  await expect(page.locator("#vendors-card")).toBeVisible();
  await page.reload();
  await expect(page.locator("#vendors-card")).toBeVisible();
});

test("ticking a booking records the price and re-balances the budget", async ({ page }) => {
  await makePlan(page);
  await tab(page, "Timeline").click();
  await page.locator('label[for="task-w-venue"]').click();
  await page.locator("#agreed-w-venue").fill("3.5 lakh");
  await page.locator("#adv-w-venue").fill("50,000");
  await page.getByRole("button", { name: "Save booking" }).click();
  await expect(page.locator('label[for="task-w-venue"] .when')).toHaveText("Booked for ₹3,50,000 · advance ₹50,000");
  await expect(tab(page, "Budget")).toContainText("₹3,50,000 booked");
  expect((await saved(page)).deals["w-venue"]).toEqual({ agreedINR: 3_50_000, advanceINR: 50_000 });
});

test("Toran suggests: nothing happens until you approve", async ({ page }) => {
  await makePlan(page);
  const card = page.locator(".suggestion", { hasText: "Agree total budget" });
  await expect(card).toBeVisible();
  expect((await saved(page)).done["w-budget"]).toBeFalsy();
  await card.getByRole("button", { name: "Mark as done" }).click();
  await expect(card).toBeHidden();
  expect((await saved(page)).done["w-budget"]).toBe(true);
  // "Not now" hides a card without doing anything.
  const venue = page.locator(".suggestion", { hasText: "Book venue" });
  await venue.getByRole("button", { name: /Not now/ }).click();
  await expect(venue).toBeHidden();
  expect((await saved(page)).deals).toEqual({});
});

test("calendar file has every open task and the event day", async ({ page }) => {
  await makePlan(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Add to calendar" }).first().click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("toran-plan.ics");
  const ics = await (await import("node:fs/promises")).readFile(await file.path(), "utf8");
  expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
  expect(ics).toContain("DTSTART;VALUE=DATE:20270214");
  expect(ics.match(/BEGIN:VEVENT/g)?.length).toBeGreaterThan(10);
});
