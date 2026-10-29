import express, { Router } from "express";
import { z } from "zod";
import { MAX_QUOTE_BYTES, QUOTE_MIME, type QuoteMime, readQuote, sniffMime } from "../ai/quoteReader.js";
import { checkQuote, QuoteSchema, vendorMessage } from "../engine/quote.js";
import { logUpstream } from "../http/errors.js";
import { perMinute } from "../http/limits.js";
import type { RouteDeps } from "./deps.js";

const CheckBody = z.strictObject({
  quote: QuoteSchema,
  guestCount: z.number().int().min(1).max(5000),
  plannedINR: z.number().int().min(0).max(5_00_00_000).optional(),
});

/** The Content-Type the client claimed, without parameters. */
const claimedType = (header: unknown) =>
  String(header ?? "")
    .split(";")[0]
    .trim();

/**
 * POST /api/quote/read: a photo or PDF of a quotation into a draft the user confirms. The file lives only
 * in memory for this request: never written to disk, logged or served back. Its type is checked by its bytes.
 * POST /api/quote/check: every check on the confirmed quote. Plain code, no AI.
 */
export function quoteRoutes({ ai, limits }: RouteDeps) {
  const router = Router();
  router.post(
    "/api/quote/read",
    perMinute(limits.quotePerMinute, "Too many quotes at once. Please wait a minute and try again."),
    express.raw({ type: [...QUOTE_MIME], limit: MAX_QUOTE_BYTES }),
    async (req, res) => {
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(415).json({ error: "Please upload a photo (JPG, PNG, WebP) or a PDF of the quotation." });
        return;
      }
      // The type is decided by the file's first bytes, and must match what the client claimed.
      const actual = sniffMime(body);
      if (!actual || actual !== claimedType(req.headers["content-type"])) {
        res.status(415).json({ error: "That file doesn't look like a photo or PDF. Please try another." });
        return;
      }
      if (!ai.available) {
        const error = "Reading quotes needs the AI, which is offline right now. You can type the lines in instead.";
        res.status(503).json({ error, manual: true });
        return;
      }
      try {
        res.json(await readQuote(body, actual as QuoteMime, ai));
      } catch (err) {
        logUpstream("Quote read", err);
        res.status(502).json({ error: "Couldn't read this quotation. Try a clearer, well-lit photo, or type the lines in.", manual: true });
      }
    },
  );

  router.post("/api/quote/check", perMinute(limits.aiPerMinute), express.json({ limit: "64kb" }), (req, res) => {
    const parsed = CheckBody.safeParse(req.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 5).map((i) => ({ field: i.path.join("."), message: i.message }));
      res.status(400).json({ error: "Please check the quote lines.", issues });
      return;
    }
    const { quote, guestCount, plannedINR } = parsed.data;
    const check = checkQuote(quote, { guestCount, plannedINR });
    res.json({ ...check, message: vendorMessage(check.questions, quote.vendorName) });
  });
  return router;
}
