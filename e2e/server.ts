/**
 * Test server for the browser tests: the real app, with AI offline (so every
 * fallback is exercised) and a fake Google Places client with fixed listings.
 * No API keys and no network needed.
 */
import { createApp } from "../src/app.js";
import { offlineClient } from "../src/ai/client.js";
import { sanitizePlaces, type PlacesClient } from "../src/places/places.js";

const listing = (i: number, area: string) => ({
  id: `place-${i}`,
  displayName: { text: ["Shubh Rasoi Caterers", "Annapurna Foods", "Royal Feast Caterers"][i] },
  formattedAddress: `SCO ${10 + i}, Sector ${5 + i}, ${area}`,
  nationalPhoneNumber: `098765 4321${i}`,
  rating: 4.2 + i / 10,
  userRatingCount: 40 * (i + 1),
  googleMapsUri: `https://maps.google.com/?cid=${i}`,
  businessStatus: "OPERATIONAL",
});

const places: PlacesClient = {
  available: true,
  async search(req) {
    return sanitizePlaces({ places: [0, 1, 2].map((i) => listing(i, req.city ?? "near you")) });
  },
};

const port = Number(process.env.E2E_PORT) || 8123;
// Every test runs from the same address, so the per-IP limits are raised here (and only here).
const many = 10_000;
createApp({
  ai: offlineClient,
  places,
  today: () => "2026-10-28",
  apiRateLimitPer15Min: many,
  aiRateLimitPerMinute: many,
  planRateLimitPerMinute: many,
  quoteRateLimitPerMinute: many,
  placesRateLimitPerMinute: many,
}).listen(port, () => console.log(`e2e server on ${port}`));
