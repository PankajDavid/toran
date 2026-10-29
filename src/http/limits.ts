import { rateLimit } from "express-rate-limit";

/** Requests per IP. Every route has one; AI, quote reading and Places are the tightest because they cost money. */
export interface RateLimits {
  /** Overall API requests per 15 minutes. */
  apiPer15Min: number;
  /** Routes that can call Gemini, and the quote check. */
  aiPerMinute: number;
  /** Reading a quotation photo: the most expensive AI call. */
  quotePerMinute: number;
  /** Google Places searches (paid per call; also capped per day in Google Cloud). */
  placesPerMinute: number;
  /** Plan and calendar: plain code, cheap. */
  planPerMinute: number;
}

export const DEFAULT_LIMITS: RateLimits = { apiPer15Min: 300, aiPerMinute: 20, quotePerMinute: 8, placesPerMinute: 10, planPerMinute: 30 };

const MINUTE_MS = 60_000;

/** A per-IP limiter with a plain-English message. */
export const perMinute = (limit: number, message = "Too many requests. Please wait a minute and try again.") =>
  rateLimit({ windowMs: MINUTE_MS, limit, standardHeaders: "draft-8", legacyHeaders: false, message: { error: message } });

/** The overall cap per IP on the API. Static files are not counted: a page load fetches about 20 of them. */
export const apiCap = (limit: number) => rateLimit({ windowMs: 15 * MINUTE_MS, limit, standardHeaders: "draft-8", legacyHeaders: false });
