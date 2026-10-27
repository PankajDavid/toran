import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, parsePlanInput, PlanInputError, todayInIndia } from "./engine/index.js";
import { aiClientFromEnv, type AiClient } from "./ai/client.js";
import { generateIdeas, IdeasRequestSchema } from "./ai/ideas.js";
import { runInterviewTurn, TurnSchema } from "./interview/interview.js";

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
  /** Injected for tests; production builds one from GEMINI_API_KEY (offline if absent). */
  ai?: AiClient;
}

export function createApp(opts: AppOptions = {}) {
  const today = opts.today ?? (() => todayInIndia());
  const ai = opts.ai ?? aiClientFromEnv();
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

  app.use(rateLimit({ windowMs: 15 * 60_000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use(express.json({ limit: "10kb" }));

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.join(__dirname, "..", "public"), { index: "index.html", maxAge: "1h" }));

  app.get("/health", (_req, res) => {
    // Reports whether AI is configured, never the key itself.
    res.json({ status: "ok", ai: ai.available ? "configured" : "offline" });
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

  const planLimiter = rateLimit({
    windowMs: 60_000,
    limit: opts.planRateLimitPerMinute ?? 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Please wait a minute and try again." },
  });

  app.post("/api/plan", planLimiter, (req, res) => {
    try {
      res.json(buildPlan(req.body, today()));
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
