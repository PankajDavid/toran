import { Router } from "express";
import { buildCalendar, buildPlan } from "../engine/index.js";
import { handlePlanInputError } from "../http/errors.js";
import { perMinute } from "../http/limits.js";
import type { RouteDeps } from "./deps.js";

const EVENT_TITLE: Record<string, string> = {
  wedding: "Wedding",
  birthday: "Birthday",
  party: "Get-together",
  community: "Community event",
};

/** Bookings and ticked tasks travel alongside the plan input but are validated separately. */
function splitPlanBody(raw: unknown): { input: unknown; deals: unknown; done: unknown } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { input: raw, deals: [], done: [] };
  const { deals = [], done = [], ...input } = raw as Record<string, unknown>;
  return { input, deals, done };
}

/**
 * POST /api/plan: the whole plan (budget, timeline, vendors, bookings, suggestions), recalculated by code.
 * POST /api/calendar: the open deadlines and the event day as a calendar file. Nothing is stored.
 */
export function planRoutes({ today, limits }: RouteDeps) {
  const router = Router();
  const limit = perMinute(limits.planPerMinute);

  router.post("/api/plan", limit, (req, res) => {
    try {
      const { input, deals, done } = splitPlanBody(req.body);
      res.json(buildPlan(input, today(), deals, done));
    } catch (err) {
      handlePlanInputError(err, res);
    }
  });

  router.post("/api/calendar", limit, (req, res) => {
    try {
      const { input, done } = splitPlanBody(req.body);
      const plan = buildPlan(input, today(), [], done);
      const doneSet = new Set(Array.isArray(done) ? done.filter((x: unknown) => typeof x === "string") : []);
      const ics = buildCalendar(plan.timeline, { title: `${EVENT_TITLE[plan.input.eventType]} (Toran)`, done: doneSet, stamp: new Date() });
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="toran-plan.ics"');
      res.send(ics);
    } catch (err) {
      handlePlanInputError(err, res);
    }
  });
  return router;
}
