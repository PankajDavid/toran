import { Router } from "express";
import { generateIdeas, IdeasRequestSchema } from "../ai/ideas.js";
import { parsePlanInput } from "../engine/index.js";
import { handlePlanInputError } from "../http/errors.js";
import { perMinute } from "../http/limits.js";
import type { RouteDeps } from "./deps.js";

/** POST /api/ideas: themes, decor, menu, invitation wording and tips (AI, with an offline fallback). */
export function ideasRoutes({ ai, today, limits }: RouteDeps) {
  const router = Router();
  router.post("/api/ideas", perMinute(limits.aiPerMinute), async (req, res) => {
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
      handlePlanInputError(err, res);
    }
  });
  return router;
}
