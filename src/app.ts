import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { type AiClient, aiClientFromEnv } from "./ai/client.js";
import { todayInIndia } from "./engine/index.js";
import { errorHandler, notFound } from "./http/errors.js";
import { apiCap, DEFAULT_LIMITS } from "./http/limits.js";
import { accessLog, applySecurityHeaders, stripOverrideHeaders } from "./http/security.js";
import { type PlacesClient, placesClientFromEnv } from "./places/places.js";
import type { RouteDeps } from "./routes/deps.js";
import { ideasRoutes } from "./routes/ideas.js";
import { interviewRoutes } from "./routes/interview.js";
import { planRoutes } from "./routes/plan.js";
import { quoteRoutes } from "./routes/quote.js";
import { vendorRoutes } from "./routes/vendors.js";

export { stripOverrideHeaders };

export interface AppOptions {
  /** Injected for tests; production uses today's date in India. */
  today?: () => string;
  /** Injected for tests; production builds one from GEMINI_API_KEY (offline if absent). */
  ai?: AiClient;
  /** Injected for tests; production builds one from GOOGLE_MAPS_API_KEY (offline if absent). */
  places?: PlacesClient;
  planRateLimitPerMinute?: number;
  aiRateLimitPerMinute?: number;
  quoteRateLimitPerMinute?: number;
  placesRateLimitPerMinute?: number;
  /** Overall API requests per IP per 15 minutes (default 300). Raised only for browser tests. */
  apiRateLimitPer15Min?: number;
}

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const SMALL_JSON = express.json({ limit: "10kb" });

/**
 * App files (page, scripts, styles, worker, manifest) are always revalidated so updates show on the next
 * open ("no-cache" still allows a 304). Images, icons and fonts rarely change: cached for a day.
 */
const staticFiles = express.static(PUBLIC_DIR, {
  index: "index.html",
  setHeaders(res, filePath) {
    res.setHeader("Cache-Control", /\.(html|js|css|webmanifest)$/.test(filePath) ? "no-cache" : "public, max-age=86400");
  },
});

export function createApp(opts: AppOptions = {}) {
  const deps: RouteDeps = {
    ai: opts.ai ?? aiClientFromEnv(),
    places: opts.places ?? placesClientFromEnv(),
    today: opts.today ?? (() => todayInIndia()),
    limits: {
      apiPer15Min: opts.apiRateLimitPer15Min ?? DEFAULT_LIMITS.apiPer15Min,
      aiPerMinute: opts.aiRateLimitPerMinute ?? DEFAULT_LIMITS.aiPerMinute,
      quotePerMinute: opts.quoteRateLimitPerMinute ?? DEFAULT_LIMITS.quotePerMinute,
      placesPerMinute: opts.placesRateLimitPerMinute ?? DEFAULT_LIMITS.placesPerMinute,
      planPerMinute: opts.planRateLimitPerMinute ?? DEFAULT_LIMITS.planPerMinute,
    },
  };
  const app = express();

  app.use(stripOverrideHeaders); // first: nothing may disguise a method or path
  app.set("trust proxy", 1); // one hop: the hosting platform's load balancer
  applySecurityHeaders(app);
  app.use(accessLog);
  app.use(["/api", "/health"], apiCap(deps.limits.apiPer15Min));
  // Small JSON bodies everywhere, except a confirmed quote (up to 60 lines), which its route parses at 64kb.
  app.use((req, res, next) => (req.path === "/api/quote/check" ? next() : SMALL_JSON(req, res, next)));
  app.use(staticFiles);

  app.get("/health", (_req, res) => {
    // Whether AI and Places are configured, never the keys themselves.
    res.json({ status: "ok", ai: deps.ai.available ? "configured" : "offline", places: deps.places.available ? "configured" : "offline" });
  });
  for (const routes of [interviewRoutes, planRoutes, quoteRoutes, ideasRoutes, vendorRoutes]) app.use(routes(deps));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
