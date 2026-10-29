import { Router } from "express";
import { logUpstream } from "../http/errors.js";
import { perMinute } from "../http/limits.js";
import { FindVendorsSchema } from "../places/places.js";
import type { RouteDeps } from "./deps.js";

/** POST /api/vendors/find: real vendors from Google Maps for one category. Nothing is stored or logged. */
export function vendorRoutes({ places, limits }: RouteDeps) {
  const router = Router();
  router.post(
    "/api/vendors/find",
    perMinute(limits.placesPerMinute, "Too many searches. Please wait a minute and try again."),
    async (req, res) => {
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
        logUpstream("Places search", err);
        res.status(502).json({ error: "Couldn't search Google Maps just now. Please try again in a minute." });
      }
    },
  );
  return router;
}
