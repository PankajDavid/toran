import { Router } from "express";
import { runInterviewTurn, TurnSchema } from "../interview/interview.js";
import { perMinute } from "../http/limits.js";
import type { RouteDeps } from "./deps.js";

/** POST /api/interview: one turn of the planning conversation (local parser first, AI only for gaps). */
export function interviewRoutes({ ai, today, limits }: RouteDeps) {
  const router = Router();
  router.post("/api/interview", perMinute(limits.aiPerMinute), async (req, res) => {
    const turn = TurnSchema.safeParse(req.body);
    if (!turn.success) {
      res.status(400).json({ error: "Please check your answer." });
      return;
    }
    res.json(await runInterviewTurn(turn.data, today(), ai));
  });
  return router;
}
