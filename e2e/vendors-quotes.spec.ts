import { expect, test } from "@playwright/test";
import { makePlan, openVendor, saved, tab, typeQuote } from "./helpers";

test("find real vendors on Google Maps and add one to the list", async ({ page }) => {
  await makePlan(page);
  const cat = await openVendor(page, "Caterer");
  await expect(page.locator("#vc-catering")).toHaveValue("Ludhiana");
  await cat.getByRole("button", { name: "Search", exact: true }).click();
  await expect(cat.getByText("Google Maps results in Ludhiana")).toBeVisible();
  await expect(cat.getByText("doesn't vouch for any vendor")).toBeVisible();
  const first = cat.locator(".v-found-item").first();
  await first.getByRole("button", { name: "Add to my list" }).click();
  await expect(first.getByRole("button", { name: "In your list" })).toBeDisabled();
  await expect(cat.locator(".v-item").first()).toContainText("98765 43210");
  await expect(cat.locator(".v-item select").first()).toHaveValue("to-contact");
});

test("bad city names never reach the search", async ({ page }) => {
  await makePlan(page);
  const cat = await openVendor(page, "Caterer");
  await page.locator("#vc-catering").fill("Ludhiana<script>");
  await cat.getByRole("button", { name: "Search", exact: true }).click();
  await expect(cat.locator(".v-find-status").first()).toHaveText("Enter a city name, like Panchkula.");
});

test("confirming a vendor books them; un-confirming removes the booking", async ({ page }) => {
  await makePlan(page);
  const cat = await openVendor(page, "Caterer");
  await page.locator("#vn-catering").fill("Shubh Rasoi");
  await cat.getByRole("button", { name: "Add vendor" }).click();
  await cat.locator(".v-item").getByRole("button", { name: "Confirm", exact: true }).click();
  await cat.locator(".v-item .booking input").nth(0).fill("1,80,000");
  await cat.getByRole("button", { name: "Confirm vendor" }).click();
  await expect(cat.locator(".v-item.s-confirmed")).toContainText("Booked for ₹1,80,000");
  expect((await saved(page)).deals["w-caterer"].agreedINR).toBe(1_80_000);
  await cat.locator(".v-item select").selectOption("shortlisted");
  await expect.poll(async () => (await saved(page)).deals).toEqual({});
});

test("the Quote Checker catches wrong maths and asks the vendor politely", async ({ page }) => {
  await makePlan(page);
  await typeQuote(page, "Sample Caterers", 250, 650, 1_72_500);
  await expect(page.locator(".verdict-title")).toHaveText("1 mistake found");
  await expect(page.locator(".finding.problem")).toContainText("250 × ₹650 = ₹1,62,500, but the quote says ₹1,72,500");
  await expect(page.locator(".vendor-msg .invitation")).toContainText("Namaste Sample Caterers ji,");
});

test("a vendor can't be booked twice: same price says booked, new price updates, another vendor replaces", async ({ page }) => {
  await makePlan(page);
  await typeQuote(page, "Annapurna", 250, 600, 1_50_000);
  await page.getByRole("button", { name: "Book this vendor" }).click();
  await expect(page.locator(".verdict-done")).toContainText("Booked Annapurna for ₹1,50,000");

  await typeQuote(page, "Annapurna", 250, 600, 1_50_000);
  await expect(page.locator(".verdict .verdict-done")).toContainText("Annapurna is booked for ₹1,50,000");
  await expect(page.getByRole("button", { name: "Book this vendor" })).toHaveCount(0);

  await typeQuote(page, "Annapurna", 250, 640, 1_60_000);
  await page.getByRole("button", { name: "Update booking" }).click();
  await expect(tab(page, "Budget")).toContainText("₹1,60,000 booked");

  await typeQuote(page, "Royal Feast", 250, 560, 1_40_000);
  await expect(page.locator(".book-form")).toContainText("Booking Royal Feast replaces that booking");
  await page.getByRole("button", { name: "Replace booking" }).click();
  await expect(tab(page, "Budget")).toContainText("₹1,40,000 booked");
  expect(Object.keys((await saved(page)).deals)).toEqual(["w-caterer"]);
});
