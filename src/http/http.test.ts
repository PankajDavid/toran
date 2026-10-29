import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { offlineClient } from "../ai/client.js";
import { createApp } from "../app.js";
import { errorHandler, logUpstream } from "./errors.js";
import { DEFAULT_LIMITS } from "./limits.js";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp({ today: () => "2026-10-27", ai: offlineClient }).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const plan = { eventType: "birthday", subType: "kid", totalBudgetINR: 40_000, guestCount: 30, cityTier: 2, eventDate: "2026-11-20" };

describe("rate limits", () => {
  it("defaults are the documented ones, tightest where calls cost money", () => {
    expect(DEFAULT_LIMITS).toEqual({ apiPer15Min: 300, aiPerMinute: 20, quotePerMinute: 8, placesPerMinute: 10, planPerMinute: 30 });
    expect(DEFAULT_LIMITS.quotePerMinute).toBeLessThan(DEFAULT_LIMITS.aiPerMinute);
    expect(DEFAULT_LIMITS.placesPerMinute).toBeLessThan(DEFAULT_LIMITS.planPerMinute);
  });

  it("every API reply carries the standard rate-limit header", async () => {
    const res = await post("/api/plan", plan);
    expect(res.headers.get("ratelimit-policy")).toBeTruthy();
  });
});

describe("plan body", () => {
  it("rejects a body that is a list, not an object", async () => {
    expect((await post("/api/plan", [plan])).status).toBe(400);
    expect((await post("/api/calendar", [plan])).status).toBe(400);
  });

  it("bookings and ticked tasks are split off before the plan is validated", async () => {
    const res = await post("/api/plan", { ...plan, deals: [], done: [] });
    expect(res.status).toBe(200);
  });

  it("the calendar rejects ticked tasks that aren't text, and accepts unknown task ids", async () => {
    expect((await post("/api/calendar", { ...plan, done: [42] })).status).toBe(400);
    const res = await post("/api/calendar", { ...plan, done: ["x-no-such-task"] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
  });
});

describe("ideas", () => {
  it("rejects a malformed request and an invalid plan with a generic message", async () => {
    const bad = await post("/api/ideas", { nonsense: true });
    expect(bad.status).toBe(400);
    const badPlan = await post("/api/ideas", { plan: { ...plan, guestCount: -5 } });
    expect(badPlan.status).toBe(400);
    expect((await badPlan.json()).error).toBe("Please check your inputs.");
  });
});

describe("errors", () => {
  it("never sends error details to the client", async () => {
    const app = express();
    app.get("/boom", () => {
      throw new Error("secret detail");
    });
    app.use(errorHandler);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = app.listen(0);
    await new Promise((r) => s.once("listening", r));
    const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/boom`);
    await new Promise<void>((r) => s.close(() => r()));
    quiet.mockRestore();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(JSON.parse(text).error).toBe("Something went wrong. Please try again.");
  });

  it("logs an upstream failure by kind only, with or without a detail", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logUpstream("Places search", { kind: "timeout" });
    logUpstream("Quote read", new Error("x"));
    expect(warn.mock.calls.map((c) => c[0])).toEqual(["Places search failed (timeout)", "Quote read failed (error)"]);
    warn.mockRestore();
  });

  it("unknown routes get a plain 404", async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});

describe("each route uses its own limit", () => {
  it("Places, quote reading, AI and plan each run out separately, with their own message", async () => {
    const app = createApp({
      today: () => "2026-10-27",
      ai: offlineClient,
      placesRateLimitPerMinute: 1,
      quoteRateLimitPerMinute: 2,
      aiRateLimitPerMinute: 3,
      planRateLimitPerMinute: 4,
    });
    const s = app.listen(0);
    await new Promise((r) => s.once("listening", r));
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    const hit = async (path: string, body: unknown, type = "application/json") => {
      const r = await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": type }, body: body as string });
      return { status: r.status, error: r.status === 429 ? (await r.json()).error : "" };
    };
    const until429 = async (path: string, body: unknown, type?: string) => {
      for (let n = 1; n <= 10; n++) {
        const r = await hit(path, body, type);
        if (r.status === 429) return { allowed: n - 1, error: r.error };
      }
      return { allowed: 10, error: "" };
    };
    try {
      const places = await until429("/api/vendors/find", JSON.stringify({ category: "venue", city: "Pune" }));
      const quote = await until429("/api/quote/read", "x", "image/png");
      const ai = await until429("/api/ideas", JSON.stringify({}));
      const planned = await until429("/api/plan", JSON.stringify(plan));
      expect([places.allowed, quote.allowed, ai.allowed, planned.allowed]).toEqual([1, 2, 3, 4]);
      expect(places.error).toContain("Too many searches");
      expect(quote.error).toContain("Too many quotes");
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});
