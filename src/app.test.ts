import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "./app.js";
import { offlineClient } from "./ai/client.js";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp({ today: () => "2026-10-27", planRateLimitPerMinute: 5, aiRateLimitPerMinute: 6, ai: offlineClient }).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const valid = { eventType: "birthday", subType: "kid", totalBudgetINR: 40_000, guestCount: 30, cityTier: 2, eventDate: "2026-11-20" };
const post = (body: unknown, raw = false) =>
  fetch(`${base}/api/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) });

describe("HTTP API", () => {
  it("health check works", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", ai: "offline" });
  });

  it("interview works end to end without AI: one Hinglish sentence plus button taps", async () => {
    const turn = (body: unknown) =>
      fetch(`${base}/api/interview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    let r = await turn({ text: "Beti ki shaadi hai 14 Feb ko, Ludhiana mein, 300 log, 15 lakh budget" });
    expect(r.known).toMatchObject({ eventType: "wedding", eventDate: "2027-02-14", guestCount: 300, totalBudgetINR: 1_500_000, city: "Ludhiana", cityTier: 2, subType: "punjabi" });
    expect(r.guessed).toContain("subType");
    expect(r.next.field).toBe("subEvents");
    r = await turn({ known: r.known, guessed: r.guessed, set: { subEvents: ["mehendi", "ceremony"] } });
    expect(r.next.field).toBe("diet");
    r = await turn({ known: r.known, guessed: r.guessed, set: { diet: "veg" } });
    expect(r.next).toBeNull();
    const plan = await post(r.planInput).then((x) => x.json());
    expect(plan.budget.totalINR).toBe(1_500_000);
  });

  it("ideas fall back to the offline set when AI is unavailable", async () => {
    const res = await fetch(`${base}/api/ideas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: { ...valid, diet: "jain" } }),
    });
    const body = await res.json();
    expect(body.source).toBe("offline");
    expect(JSON.stringify(body.ideas.menu)).not.toMatch(/onion|garlic|potato|chicken/i);
  });

  it("accepts bookings alongside the plan and re-balances the budget", async () => {
    const plan = await post({ ...valid, deals: [{ taskId: "b-venue", agreedINR: 5_000, advanceINR: 1_000 }] }).then((x) => x.json());
    expect(plan.spending.bookedCount).toBe(1);
    expect(plan.input.deals).toBeUndefined();
    const bad = await post({ ...valid, deals: [{ taskId: "b-venue", agreedINR: 5_000, advanceINR: 9_000 }] });
    expect(bad.status).toBe(400);
  });

  it("rejects malformed interview turns", async () => {
    const res = await fetch(`${base}/api/interview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x".repeat(600) }) });
    expect(res.status).toBe(400);
  });

  it("returns a plan for valid input", async () => {
    const res = await post(valid);
    expect(res.status).toBe(200);
    const plan = await res.json();
    expect(plan.budget.lines.reduce((s: number, l: { amountINR: number }) => s + l.amountINR, 0)).toBe(40_000);
  });

  it("returns field-level messages for bad input", async () => {
    const res = await post({ ...valid, guestCount: 0 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues[0].field).toBe("guestCount");
  });

  it("returns a generic message for malformed JSON (no stack trace)", async () => {
    const res = await post("{not json", true);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toMatch(/at .*\.js|SyntaxError/);
  });

  it("rejects bodies over 10kb", async () => {
    const res = await post({ ...valid, padding: "x".repeat(20_000) });
    expect(res.status).toBe(413);
  });

  it("sends security headers and no CORS or x-powered-by headers", async () => {
    const res = await fetch(`${base}/health`, { headers: { origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("x-powered-by")).toBeNull();
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("ignores method-override headers", async () => {
    const res = await fetch(`${base}/api/plan`, { method: "GET", headers: { "x-http-method-override": "POST" } });
    expect(res.status).toBe(404);
  });

  it("rate-limits the plan endpoint", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await post(valid)).status);
    expect(statuses).toContain(429);
  });
});
