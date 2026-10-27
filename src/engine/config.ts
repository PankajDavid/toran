/**
 * Planning defaults.
 *
 * ROUGH DEFAULTS — these percentages and floors are starting points for
 * Indian events, not market data. Users can see and adjust every number in
 * the UI. Edit here to change the defaults everywhere.
 *
 * Shares are in basis points (1 bp = 0.01%), so each list must add up to 10000.
 * Using whole numbers avoids floating-point drift.
 */

export const EVENT_TYPES = ["wedding", "birthday", "party", "community"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const WEDDING_STYLES = ["punjabi", "south-indian", "bengali", "christian", "other"] as const;
export const WEDDING_SUB_EVENTS = ["haldi", "mehendi", "sangeet", "ceremony", "reception"] as const;
export const BIRTHDAY_KINDS = ["kid", "adult", "milestone"] as const;
/** Smaller social gatherings. A kitty party is planned as one gathering for the host. */
export const PARTY_KINDS = ["kitty", "anniversary", "other"] as const;
export const COMMUNITY_KINDS = ["jagran", "langar", "diwali-mela", "rwa-function", "other"] as const;

export const SUB_TYPES: Record<EventType, readonly string[]> = {
  wedding: WEDDING_STYLES,
  birthday: BIRTHDAY_KINDS,
  party: PARTY_KINDS,
  community: COMMUNITY_KINDS,
};

export type WeddingSubEvent = (typeof WEDDING_SUB_EVENTS)[number];
export type CityTier = 1 | 2 | 3;

export interface CategoryShare {
  key: string;
  label: string;
  bp: number;
  /** Marks the food line, used for the per-guest food check. */
  food?: true;
}

const WEDDING: CategoryShare[] = [
  { key: "venue", label: "Venue", bp: 2000 },
  { key: "catering", label: "Catering", bp: 2800, food: true },
  { key: "decor", label: "Decor & flowers", bp: 1200 },
  { key: "photo-video", label: "Photography & video", bp: 800 },
  { key: "outfits", label: "Outfits & jewellery", bp: 800 },
  { key: "entertainment", label: "DJ, band & dhol", bp: 600 },
  { key: "invites-gifts", label: "Invitations & gifts", bp: 500 },
  { key: "beauty", label: "Makeup & mehendi", bp: 400 },
  { key: "logistics", label: "Transport & stay", bp: 400 },
  { key: "contingency", label: "Contingency buffer", bp: 500 },
];

/** Keyed by `${eventType}:${subType}`; weddings share one list across styles. */
export const ALLOCATIONS: Record<string, CategoryShare[]> = {
  "wedding:punjabi": WEDDING,
  "wedding:south-indian": WEDDING,
  "wedding:bengali": WEDDING,
  "wedding:christian": WEDDING,
  "wedding:other": WEDDING,
  "birthday:kid": [
    { key: "venue", label: "Venue", bp: 2000 },
    { key: "catering", label: "Food & snacks", bp: 2500, food: true },
    { key: "decor", label: "Decor & balloons", bp: 1800 },
    { key: "cake", label: "Cake", bp: 800 },
    { key: "entertainment", label: "Games & entertainer", bp: 1200 },
    { key: "return-gifts", label: "Return gifts", bp: 700 },
    { key: "photo-video", label: "Photography", bp: 500 },
    { key: "contingency", label: "Contingency buffer", bp: 500 },
  ],
  "birthday:adult": [
    { key: "venue", label: "Venue", bp: 2500 },
    { key: "catering", label: "Food & drinks", bp: 3500, food: true },
    { key: "decor", label: "Decor", bp: 1200 },
    { key: "cake", label: "Cake", bp: 500 },
    { key: "entertainment", label: "Music & entertainment", bp: 1200 },
    { key: "photo-video", label: "Photography", bp: 600 },
    { key: "contingency", label: "Contingency buffer", bp: 500 },
  ],
  "birthday:milestone": [
    { key: "venue", label: "Venue", bp: 2500 },
    { key: "catering", label: "Food & drinks", bp: 3500, food: true },
    { key: "decor", label: "Decor", bp: 1300 },
    { key: "cake", label: "Cake", bp: 400 },
    { key: "entertainment", label: "Music & entertainment", bp: 1000 },
    { key: "photo-video", label: "Photography & video", bp: 700 },
    { key: "invites-gifts", label: "Invitations", bp: 100 },
    { key: "contingency", label: "Contingency buffer", bp: 500 },
  ],
  "party:kitty": [
    { key: "venue", label: "Venue (home, café or hall)", bp: 2000 },
    { key: "catering", label: "Food & drinks", bp: 4500, food: true },
    { key: "decor", label: "Decor & theme", bp: 1000 },
    { key: "games-prizes", label: "Games & prizes", bp: 1500 },
    { key: "return-gifts", label: "Return gifts", bp: 500 },
    { key: "contingency", label: "Contingency buffer", bp: 500 },
  ],
  "party:anniversary": [
    { key: "venue", label: "Venue", bp: 2500 },
    { key: "catering", label: "Food & drinks", bp: 3500, food: true },
    { key: "decor", label: "Decor", bp: 1500 },
    { key: "cake", label: "Cake", bp: 500 },
    { key: "entertainment", label: "Music & entertainment", bp: 800 },
    { key: "photo-video", label: "Photography", bp: 700 },
    { key: "contingency", label: "Contingency buffer", bp: 500 },
  ],
  "party:other": [
    { key: "venue", label: "Venue", bp: 2500 },
    { key: "catering", label: "Food & drinks", bp: 3500, food: true },
    { key: "decor", label: "Decor", bp: 1500 },
    { key: "entertainment", label: "Music & entertainment", bp: 1000 },
    { key: "photo-video", label: "Photography", bp: 500 },
    { key: "invites-gifts", label: "Invitations & gifts", bp: 500 },
    { key: "contingency", label: "Contingency buffer", bp: 500 },
  ],
  "community:jagran": [
    { key: "venue", label: "Tent & seating", bp: 2500 },
    { key: "sound-lighting", label: "Sound & lighting", bp: 1500 },
    { key: "performers", label: "Bhajan mandali", bp: 2000 },
    { key: "catering", label: "Prasad & langar", bp: 2000, food: true },
    { key: "decor", label: "Decor & flowers", bp: 1000 },
    { key: "logistics", label: "Logistics", bp: 500 },
    { key: "contingency", label: "Contingency buffer", bp: 500 },
  ],
  "community:langar": [
    { key: "catering", label: "Ration & ingredients", bp: 4500, food: true },
    { key: "cooking", label: "Cooking equipment & fuel", bp: 1500 },
    { key: "venue", label: "Tent & seating", bp: 1500 },
    { key: "utensils", label: "Utensils & serving", bp: 1000 },
    { key: "cleanup", label: "Cleanup", bp: 500 },
    { key: "logistics", label: "Logistics", bp: 500 },
    { key: "contingency", label: "Contingency buffer", bp: 500 },
  ],
  "community:diwali-mela": [
    { key: "venue", label: "Ground & tent", bp: 2000 },
    { key: "stalls", label: "Stalls setup", bp: 1500 },
    { key: "sound-lighting", label: "Lighting & sound", bp: 1500 },
    { key: "entertainment", label: "Performances & games", bp: 1500 },
    { key: "catering", label: "Food", bp: 1000, food: true },
    { key: "safety", label: "Safety & security", bp: 1000 },
    { key: "promotion", label: "Promotion", bp: 500 },
    { key: "contingency", label: "Contingency buffer", bp: 1000 },
  ],
  "community:rwa-function": [
    { key: "venue", label: "Tent & seating", bp: 2000 },
    { key: "catering", label: "Catering", bp: 3000, food: true },
    { key: "sound-lighting", label: "Sound", bp: 1000 },
    { key: "entertainment", label: "Performances & games", bp: 1500 },
    { key: "decor", label: "Decor", bp: 1000 },
    { key: "prizes", label: "Prizes & mementos", bp: 500 },
    { key: "contingency", label: "Contingency buffer", bp: 1000 },
  ],
  "community:other": [
    { key: "venue", label: "Venue & tent", bp: 2500 },
    { key: "catering", label: "Catering", bp: 3000, food: true },
    { key: "sound-lighting", label: "Sound", bp: 1000 },
    { key: "entertainment", label: "Entertainment", bp: 1000 },
    { key: "decor", label: "Decor", bp: 1000 },
    { key: "logistics", label: "Logistics", bp: 500 },
    { key: "contingency", label: "Contingency buffer", bp: 1000 },
  ],
};

/**
 * Minimum food spend per guest (INR) below which we warn.
 * Tier 1 = metro, Tier 2 = large city, Tier 3 = smaller town.
 */
export const FOOD_FLOOR_PER_GUEST: Record<string, Record<CityTier, number>> = {
  wedding: { 1: 900, 2: 700, 3: 500 },
  birthday: { 1: 500, 2: 400, 3: 300 },
  party: { 1: 500, 2: 400, 3: 300 },
  "community:langar": { 1: 80, 2: 60, 3: 50 },
  community: { 1: 150, 2: 120, 3: 100 },
};

export const LIMITS = {
  minBudgetINR: 1_000,
  maxBudgetINR: 5_00_00_000, // 5 crore
  minGuests: 1,
  maxGuests: 5_000,
  maxYearsAhead: 3,
} as const;
