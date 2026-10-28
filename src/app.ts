import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCalendar, buildPlan, parsePlanInput, PlanInputError, todayInIndia } from "./engine/index.js";
import { aiClientFromEnv, type AiClient } from "./ai/client.js";
import { generateIdeas, IdeasRequestSchema } from "./ai/ideas.js";
import { runInterviewTurn, TurnSchema } from "./interview/interview.js";
import { MAX_QUOTE_BYTES, QUOTE_MIME, readQuote, sniffMime, type QuoteMime } from "./ai/quoteReader.js";
import { checkQuote, QuoteSchema, vendorMessage } from "./engine/quote.js";
import { z } from "zod";
import { FindVendorsSchema, placesClientFromEnv, type PlacesClient } from "./places/places.js";

const OVERRIDE_HEADERS = ["x-http-method-override", "x-http-method", "x-method-override", "x-original-url", "x-rewrite-url"];

/** Must run first: stops clients from disguising one HTTP method or path as another. */
export function stripOverrideHeaders(req: Request, _res: Response, next: NextFunction) {
  for (const h of OVERRIDE_HEADERS) delete req.headers[h];
  next();
}

export interface AppOptions {
  /** Injected for tests; production uses today's date in India. */
  today?: () => string;
  planRateLimitPerMinute?: number;
  aiRateLimitPerMinute?: number;
  quoteRateLimitPerMinute?: number;
  /** Injected for tests; production builds one from GEMINI_API_KEY (offline if absent). */
  ai?: AiClient;
  /** Injected for tests; production builds one from GOOGLE_MAPS_API_KEY (offline if absent). */
  places?: PlacesClient;
  placesRateLimitPerMinute?: number;
  /** Overall API requests per IP per 15 minutes (default 300). Raised only for browser tests. */
  apiRateLimitPer15Min?: number;
}

export function createApp(opts: AppOptions = {}) {
  const today = opts.today ?? (() => todayInIndia());
  const ai = opts.ai ?? aiClientFromEnv();
  const places = opts.places ?? placesClientFromEnv();
  const app = express();

  app.use(stripOverrideHeaders);
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // one hop: the hosting platform's load balancer
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  // No CORS headers are sent: browsers will only allow same-origin calls.

  // Minimal access log: method, path, status, time. Never bodies or user details.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`));
    next();
  });

  // Overall cap per IP on the API. Static files (page, scripts, icons) are not counted:
  // one page load fetches about 20 of them, and they cost nothing to serve.
  app.use(
    ["/api", "/health"],
    rateLimit({ windowMs: 15 * 60_000, limit: opts.apiRateLimitPer15Min ?? 300, standardHeaders: "draft-8", legacyHeaders: false }),
  );
  // Small JSON bodies everywhere, except a confirmed quote (up to 60 lines) which gets 64kb.
  const smallJson = express.json({ limit: "10kb" });
  app.use((req, res, next) => (req.path === "/api/quote/check" ? next() : smallJson(req, res, next)));

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // App files (page, script, styles, worker, manifest) must always be checked for a newer
  // version, so updates appear on the next open. "no-cache" still lets the browser reuse
  // its copy when unchanged (a tiny 304 reply). Images and icons rarely change: keep 1 day.
  app.use(
    express.static(path.join(__dirname, "..", "public"), {
      index: "index.html",
      setHeaders(res, filePath) {
        if (/\.(html|js|css|webmanifest)$/.test(filePath)) res.setHeader("Cache-Control", "no-cache");
        else res.setHeader("Cache-Control", "public, max-age=86400");
      },
    }),
  );

  app.get("/health", (_req, res) => {
    // Reports whether AI is configured, never the key itself.
    res.json({ status: "ok", ai: ai.available ? "configured" : "offline", places: places.available ? "configured" : "offline" });
  });

  // Every endpoint that can trigger an AI call gets this stricter limit, so
  // nobody can run up the AI bill.
  const aiLimiter = rateLimit({
    windowMs: 60_000,
    limit: opts.aiRateLimitPerMinute ?? 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Please wait a minute and try again." },
  });

  app.post("/api/interview", aiLimiter, async (req, res) => {
    const turn = TurnSchema.safeParse(req.body);
    if (!turn.success) {
      res.status(400).json({ error: "Please check your answer." });
      return;
    }
    res.json(await runInterviewTurn(turn.data, today(), ai));
  });

  // Reading a quote is the most expensive AI call: its own, tighter limit.
  const quoteLimiter = rateLimit({
    windowMs: 60_000,
    limit: opts.quoteRateLimitPerMinute ?? 8,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many quotes at once. Please wait a minute and try again." },
  });

  /**
   * Reads a quotation photo or PDF into a draft the user confirms.
   * The file lives only in memory for this request: never written to disk, never logged.
   */
  app.post("/api/quote/read", quoteLimiter, express.raw({ type: [...QUOTE_MIME], limit: MAX_QUOTE_BYTES }), async (req, res) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(415).json({ error: "Please upload a photo (JPG, PNG, WebP) or a PDF of the quotation." });
      return;
    }
    const claimed = String(req.headers["content-type"] ?? "")
      .split(";")[0]
      .trim();
    const actual = sniffMime(body);
    if (!actual || actual !== claimed) {
      res.status(415).json({ error: "That file doesn't look like a photo or PDF. Please try another." });
      return;
    }
    if (!ai.available) {
      res
        .status(503)
        .json({ error: "Reading quotes needs the AI, which is offline right now. You can type the lines in instead.", manual: true });
      return;
    }
    try {
      const result = await readQuote(body, actual as QuoteMime, ai);
      res.json(result);
    } catch (err) {
      const e = err as { kind?: string; detail?: string };
      console.warn(`Quote read failed (${e.kind ?? "error"}${e.detail ? ` ${e.detail}` : ""})`);
      res.status(502).json({ error: "Couldn't read this quotation. Try a clearer, well-lit photo, or type the lines in.", manual: true });
    }
  });

  const CheckBody = z.strictObject({
    quote: QuoteSchema,
    guestCount: z.number().int().min(1).max(5000),
    plannedINR: z.number().int().min(0).max(5_00_00_000).optional(),
  });

  /** Runs every check on a quote the user has confirmed. Plain code, no AI. */
  app.post("/api/quote/check", aiLimiter, express.json({ limit: "64kb" }), (req, res) => {
    const parsed = CheckBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Please check the quote lines.",
        issues: parsed.error.issues.slice(0, 5).map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const { quote, guestCount, plannedINR } = parsed.data;
    const check = checkQuote(quote, { guestCount, plannedINR });
    res.json({ ...check, message: vendorMessage(check.questions, quote.vendorName) });
  });

  app.post("/api/ideas", aiLimiter, async (req, res) => {
    const body = IdeasRequestSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Please check your inputs." });
      return;
    }
    try {
      const plan = parsePlanInput(body.data.plan, today());
      const { theme, notes, refine } = body.data;
      res.json(await generateIdeas(plan, { theme, notes, refine }, ai));
    } catch (err) {
      if (err instanceof PlanInputError) {
        res.status(400).json({ error: "Please check your inputs.", issues: err.issues });
        return;
      }
      throw err;
    }
  });

  // Each Places search costs money: a tight per-IP limit (and a daily cap in Google Cloud).
  const placesLimiter = rateLimit({
    windowMs: 60_000,
    limit: opts.placesRateLimitPerMinute ?? 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many searches. Please wait a minute and try again." },
  });

  /** Real vendors from Google Maps for one category. Nothing is stored or logged. */
  app.post("/api/vendors/find", placesLimiter, async (req, res) => {
    const parsed = FindVendorsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please enter a city name." });
      return;
    }
    if (!places.available) {
      res.status(503).json({ error: "Vendor search isn't switched on yet. You can still add vendors you know." });
      return;
    }
    try {
      res.json({ vendors: await places.search(parsed.data), source: "Google Maps" });
    } catch (err) {
      const e = err as { kind?: string; detail?: string };
      console.warn(`Places search failed (${e.kind ?? "error"}${e.detail ? ` ${e.detail}` : ""})`);
      res.status(502).json({ error: "Couldn't search Google Maps just now. Please try again in a minute." });
    }
  });

  const planLimiter = rateLimit({
    windowMs: 60_000,
    limit: opts.planRateLimitPerMinute ?? 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Please wait a minute and try again." },
  });

  const EVENT_TITLE: Record<string, string> = {
    wedding: "Wedding",
    birthday: "Birthday",
    party: "Get-together",
    community: "Community event",
  };

  /** The plan's open deadlines and event day as a calendar file. Built by code; nothing is stored. */
  app.post("/api/calendar", planLimiter, (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? { ...req.body } : req.body;
      const done = body && typeof body === "object" && "done" in body ? body.done : [];
      if (body && typeof body === "object") {
        delete body.done;
        delete body.deals;
      }
      const plan = buildPlan(body, today(), [], done);
      const doneSet = new Set(Array.isArray(done) ? done.filter((x: unknown) => typeof x === "string") : []);
      const ics = buildCalendar(plan.timeline, { title: `${EVENT_TITLE[plan.input.eventType]} (Toran)`, done: doneSet, stamp: new Date() });
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="toran-plan.ics"');
      res.send(ics);
    } catch (err) {
      if (err instanceof PlanInputError) {
        res.status(400).json({ error: "Please check your inputs.", issues: err.issues });
        return;
      }
      throw err;
    }
  });

  app.post("/api/plan", planLimiter, (req, res) => {
    try {
      // Bookings travel alongside the plan input but are validated separately.
      const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? { ...req.body } : req.body;
      const deals = body && typeof body === "object" && "deals" in body ? body.deals : [];
      const done = body && typeof body === "object" && "done" in body ? body.done : [];
      if (body && typeof body === "object") {
        delete body.deals;
        delete body.done;
      }
      res.json(buildPlan(body, today(), deals, done));
    } catch (err) {
      if (err instanceof PlanInputError) {
        res.status(400).json({ error: "Please check your inputs.", issues: err.issues });
        return;
      }
      throw err;
    }
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Generic message to the client; details stay in server logs.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number })?.status;
    if (status === 400 || status === 413) {
      res.status(status).json({ error: status === 413 ? "Request too large." : "Malformed request." });
      return;
    }
    console.error("Unhandled error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });

  return app;
}
