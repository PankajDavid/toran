import { z } from "zod";

/**
 * Finds real vendors through Google Places API (New) Text Search.
 * Rules: vendors are real Google listings, never invented; the search text is
 * built by code from a fixed list (no user text reaches Google except the city
 * name, which is validated); results are re-validated before they reach the page.
 * Nothing is cached or logged.
 */

import { SEARCH_TERMS } from "../engine/data/vendor-checklists.js";

export { SEARCH_TERMS };

export const FindVendorsSchema = z
  .strictObject({
    category: z.string().refine((k) => k in SEARCH_TERMS, "Unknown vendor category"),
    // City names only: letters, spaces, dots and hyphens (e.g. "Navi Mumbai", "S.A.S. Nagar").
    city: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .regex(/^[\p{L} .'-]+$/u, "City name only")
      .refine((c) => c.split(/\s+/).length <= 4, "City name only")
      .optional(),
    // Rounded on the phone to 2 decimals (about 1 km) before it is sent.
    near: z.strictObject({ lat: z.number().min(6).max(37.5), lng: z.number().min(68).max(97.5) }).optional(),
  })
  .refine((b) => b.city || b.near, "Give a city or a location");
export type FindVendorsRequest = z.infer<typeof FindVendorsSchema>;

export interface FoundVendor {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  rating?: number;
  ratingCount?: number;
  mapsUrl: string;
  website?: string;
}

export interface PlacesClient {
  readonly available: boolean;
  search(req: FindVendorsRequest): Promise<FoundVendor[]>;
}

export class PlacesError extends Error {
  constructor(
    public readonly kind: "unavailable" | "timeout" | "upstream",
    public readonly detail?: string,
  ) {
    super(`places ${kind}`);
  }
}

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.businessStatus",
].join(",");

const clean = (s: string, max: number) => s.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

const PlaceSchema = z.object({
  id: z.string().min(1).max(300),
  displayName: z.object({ text: z.string().min(1) }),
  formattedAddress: z.string().optional(),
  nationalPhoneNumber: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  userRatingCount: z.number().int().min(0).optional(),
  googleMapsUri: z.string().url(),
  websiteUri: z.string().optional(),
  businessStatus: z.string().optional(),
});

/** A Google Maps link we trust: https on a google.* or goo.gl host. Anything else is dropped. */
function safeMapsUrl(uri: string): string | null {
  try {
    const u = new URL(uri);
    return u.protocol === "https:" && /(^|\.)google\.[a-z.]+$|(^|\.)goo\.gl$/.test(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}

/** A business website, only if it's an http(s) link. */
function safeWebsite(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  try {
    const u = new URL(uri);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

const PHONE = /^[\d +()-]{6,20}$/;
const MAX_RESULTS = 8;

/** One listing in our own shape, or null if it's closed or its Maps link isn't safe. */
function toVendor(p: unknown): FoundVendor | null {
  const r = PlaceSchema.safeParse(p);
  if (!r.success) return null;
  const v = r.data;
  const mapsUrl = safeMapsUrl(v.googleMapsUri);
  if ((v.businessStatus && v.businessStatus !== "OPERATIONAL") || !mapsUrl) return null;
  const website = safeWebsite(v.websiteUri);
  const phone = v.nationalPhoneNumber && PHONE.test(v.nationalPhoneNumber) ? v.nationalPhoneNumber : undefined;
  return {
    id: v.id,
    name: clean(v.displayName.text, 80),
    ...(v.formattedAddress ? { address: clean(v.formattedAddress, 160) } : {}),
    ...(phone ? { phone } : {}),
    ...(v.rating !== undefined ? { rating: Math.round(v.rating * 10) / 10 } : {}),
    ...(v.userRatingCount !== undefined ? { ratingCount: v.userRatingCount } : {}),
    mapsUrl,
    ...(website ? { website } : {}),
  };
}

/** Keeps only open businesses with a valid Google Maps link; drops anything malformed. At most 8. */
export function sanitizePlaces(raw: unknown): FoundVendor[] {
  const places = (raw as { places?: unknown } | null)?.places;
  if (!Array.isArray(places)) return [];
  return places
    .slice(0, 20)
    .map(toVendor)
    .filter((v): v is FoundVendor => v !== null)
    .slice(0, MAX_RESULTS);
}

/** The text sent to Google: a fixed term from our list, plus the validated city. */
export function searchText(req: FindVendorsRequest): string {
  const term = SEARCH_TERMS[req.category];
  return req.city ? `${term} in ${req.city}` : `${term} near me`;
}

export const offlinePlaces: PlacesClient = {
  available: false,
  async search() {
    throw new PlacesError("unavailable");
  },
};

export function createPlacesClient(apiKey: string, fetchImpl: typeof fetch = fetch): PlacesClient {
  return {
    available: true,
    async search(req) {
      const body: Record<string, unknown> = { textQuery: searchText(req), languageCode: "en", regionCode: "IN", pageSize: 10 };
      if (req.near) body.locationBias = { circle: { center: { latitude: req.near.lat, longitude: req.near.lng }, radius: 15000 } };
      let res: Response;
      try {
        res = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: { "content-type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        throw new PlacesError((err as Error).name === "TimeoutError" ? "timeout" : "upstream", "network");
      }
      if (!res.ok) throw new PlacesError("upstream", `HTTP ${res.status}`);
      return sanitizePlaces(await res.json().catch(() => null));
    },
  };
}

export function placesClientFromEnv(): PlacesClient {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  return key ? createPlacesClient(key) : offlinePlaces;
}
