import { z } from "zod";

/**
 * Finds real vendors through Google Places API (New) Text Search.
 * Rules: vendors are real Google listings, never invented; the search text is
 * built by code from a fixed list (no user text reaches Google except the city
 * name, which is validated); results are re-validated before they reach the page.
 * Nothing is cached or logged.
 */

/** What we search for, per vendor category key (see engine/vendors.ts). */
export const SEARCH_TERMS: Record<string, string> = {
  venue: "banquet hall",
  catering: "caterers",
  "photo-video": "wedding photographer",
  decor: "event decorators",
  beauty: "bridal makeup artist",
  mehendi: "mehendi artist",
  entertainment: "DJ for events",
  outfits: "bridal boutique",
  "invites-gifts": "wedding card printers",
  logistics: "car rental for weddings",
  pandit: "pandit for puja",
  cake: "cake shop",
  "games-host": "kids party organiser",
  "sound-lighting": "sound and light on rent",
  mandali: "jagran mandali",
  ration: "wholesale grocery",
  safety: "security services",
  stalls: "tent house",
  promotion: "flex printing",
  cooking: "tent house",
  utensils: "tent house",
  cleanup: "housekeeping services",
};

export const FindVendorsSchema = z.strictObject({
  category: z.string().refine((k) => k in SEARCH_TERMS, "Unknown vendor category"),
  // City names only: letters, spaces, dots and hyphens (e.g. "Navi Mumbai", "S.A.S. Nagar").
  city: z.string().trim().min(2).max(60).regex(/^[\p{L} .'-]+$/u, "City name only").refine((c) => c.split(/\s+/).length <= 4, "City name only").optional(),
  // Rounded on the phone to 2 decimals (about 1 km) before it is sent.
  near: z.strictObject({ lat: z.number().min(6).max(37.5), lng: z.number().min(68).max(97.5) }).optional(),
}).refine((b) => b.city || b.near, "Give a city or a location");
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
  constructor(public readonly kind: "unavailable" | "timeout" | "upstream", public readonly detail?: string) {
    super(`places ${kind}`);
  }
}

const FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.nationalPhoneNumber",
  "places.rating", "places.userRatingCount", "places.googleMapsUri", "places.websiteUri", "places.businessStatus",
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

/** Keeps only open businesses with a valid Google Maps link; drops anything malformed. */
export function sanitizePlaces(raw: unknown): FoundVendor[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { places?: unknown }).places) ? (raw as { places: unknown[] }).places : [];
  const out: FoundVendor[] = [];
  for (const p of list.slice(0, 20)) {
    const r = PlaceSchema.safeParse(p);
    if (!r.success) continue;
    const v = r.data;
    if (v.businessStatus && v.businessStatus !== "OPERATIONAL") continue;
    let maps: URL;
    try { maps = new URL(v.googleMapsUri); } catch { continue; }
    if (maps.protocol !== "https:" || !/(^|\.)google\.[a-z.]+$|(^|\.)goo\.gl$/.test(maps.hostname)) continue;
    let website: string | undefined;
    if (v.websiteUri) {
      try { const w = new URL(v.websiteUri); if (w.protocol === "https:" || w.protocol === "http:") website = w.href.slice(0, 300); } catch { /* drop */ }
    }
    const phone = v.nationalPhoneNumber && /^[\d +()-]{6,20}$/.test(v.nationalPhoneNumber) ? v.nationalPhoneNumber : undefined;
    out.push({
      id: v.id,
      name: clean(v.displayName.text, 80),
      ...(v.formattedAddress ? { address: clean(v.formattedAddress, 160) } : {}),
      ...(phone ? { phone } : {}),
      ...(v.rating !== undefined ? { rating: Math.round(v.rating * 10) / 10 } : {}),
      ...(v.userRatingCount !== undefined ? { ratingCount: v.userRatingCount } : {}),
      mapsUrl: maps.href,
      ...(website ? { website } : {}),
    });
    if (out.length >= 8) break;
  }
  return out;
}

/** The text sent to Google: a fixed term from our list, plus the validated city. */
export function searchText(req: FindVendorsRequest): string {
  const term = SEARCH_TERMS[req.category];
  return req.city ? `${term} in ${req.city}` : `${term} near me`;
}

export const offlinePlaces: PlacesClient = {
  available: false,
  async search() { throw new PlacesError("unavailable"); },
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
