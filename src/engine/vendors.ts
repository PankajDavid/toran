import type { EventType } from "./config.js";

/**
 * Vendor categories and the questions to ask each one.
 * Deliberately contains NO vendor names, phone numbers or businesses:
 * the app helps users evaluate real vendors, it never invents them.
 */

interface VendorTemplate {
  key: string;
  category: string;
  questions: string[];
  onlyFor?: string[];
  /** Budget line this vendor is paid from (confirming them books this line). */
  line?: string;
}

export interface VendorChecklistItem {
  key: string;
  category: string;
  questions: string[];
  /** What to search for on Google / Google Maps (e.g. "caterers"). */
  search: string;
  /** Budget line key, when this vendor is paid from a line in this plan. */
  line?: string;
}

const COMMON_PAYMENT_Q = "What is the advance amount, payment schedule and cancellation / refund policy (in writing)?";

const TEMPLATES: Record<EventType, VendorTemplate[]> = {
  wedding: [
    { key: "venue", line: "venue", category: "Venue", questions: ["Is the date available, and is there a backup indoor space if it rains?", "What is included: power backup, parking, rooms, cleaning?", "Are outside caterers and decorators allowed, and is there a fee?", "What is the music cut-off time?", COMMON_PAYMENT_Q] },
    { key: "catering", line: "catering", category: "Caterer", questions: ["Can we do a tasting before booking?", "What is the per-plate rate and the minimum guaranteed count?", "How do you handle extra guests on the day?", "Are serving staff, crockery and counters included?", COMMON_PAYMENT_Q] },
    { key: "photo-video", line: "photo-video", category: "Photographer & videographer", questions: ["Can we see two full wedding albums, not just highlights?", "How many people, hours and events are covered?", "When will we get edited photos and the film, and in what format?", "Who owns the raw files?", COMMON_PAYMENT_Q] },
    { key: "decor", line: "decor", category: "Decorator", questions: ["Can you share photos of setups you did at our venue?", "Are fresh or artificial flowers quoted?", "What is the setup and teardown time?", COMMON_PAYMENT_Q] },
    { key: "beauty", line: "beauty", category: "Makeup artist", questions: ["Can we book a trial session?", "Which products and brands do you use?", "How many family members can you cover and by what time?", COMMON_PAYMENT_Q] },
    { key: "mehendi", line: "beauty", category: "Mehendi artist", onlyFor: ["mehendi"], questions: ["Is the henna natural and chemical-free?", "How many guests can your team cover per hour?", "Is the bride's design priced separately?", COMMON_PAYMENT_Q] },
    { key: "entertainment", line: "entertainment", category: "DJ / dhol / band", questions: ["Is sound and lighting equipment included?", "Can you play our song list and take requests?", "How long is the set, and what are overtime charges?", COMMON_PAYMENT_Q] },
    { key: "outfits", line: "outfits", category: "Outfit designer / boutique", questions: ["How many fittings are included, and how long before the wedding is the final fitting?", "Are alterations included?", "What is the delivery date, in writing?", COMMON_PAYMENT_Q] },
    { key: "invites-gifts", line: "invites-gifts", category: "Card printer / gifting", questions: ["Can we see and approve a printed proof before the full run?", "How many days for printing and delivery?", "Is envelope addressing or packing included?"] },
    { key: "logistics", line: "logistics", category: "Transport & guest rooms", questions: ["Is the rate per day or per trip, and does it include driver allowance, fuel and tolls?", "How many rooms are held, and until what date can we release extra rooms free?", "Is there a backup vehicle if one breaks down?", COMMON_PAYMENT_Q] },
    { key: "pandit", category: "Officiant (pandit / priest / pastor)", onlyFor: ["ceremony"], questions: ["Which rituals will you perform and how long will the ceremony take?", "What samagri should the family arrange?", "Will you explain the rituals to guests?"] },
  ],
  birthday: [
    { key: "venue", line: "venue", category: "Venue", questions: ["Is the space child-safe (if a kids' party)?", "Can we bring our own cake and decor?", "What are the time slot and overtime charges?", COMMON_PAYMENT_Q] },
    { key: "catering", line: "catering", category: "Food", questions: ["Is there a kids' menu and an adults' menu?", "Can you label common allergens?", "What is the per-head rate and minimum order?", COMMON_PAYMENT_Q] },
    { key: "cake", line: "cake", category: "Cake", questions: ["Is eggless available?", "How many servings does this size give?", "When and how will it be delivered?"] },
    { key: "entertainment", line: "entertainment", category: "Entertainer / games", questions: ["What age group is the act designed for?", "How long is the show, and what space do you need?", "Do you bring your own sound system?", COMMON_PAYMENT_Q] },
    { key: "decor", line: "decor", category: "Decorator", questions: ["Can you show photos of this theme?", "How long does setup take?", "Are balloons and props reused or new?"] },
    { key: "photo-video", line: "photo-video", category: "Photographer", questions: ["How many hours are covered?", "How many edited photos, and by when?", "Do you also shoot short video reels?", COMMON_PAYMENT_Q] },
  ],
  party: [
    { key: "venue", line: "venue", category: "Venue (café, restaurant or hall)", questions: ["Is there a private section for our group size?", "Is there a minimum spend or per-head package?", "Can we bring our own decor and music?", COMMON_PAYMENT_Q] },
    { key: "catering", line: "catering", category: "Food", questions: ["Is there a fixed menu or can we choose dishes?", "Are taxes and service charge included in the quote?", "What is the minimum order?"] },
    { key: "games-host", line: "games-prizes", category: "Games host / anchor", onlyFor: ["kitty"], questions: ["Which games do you run, and for how long?", "Do you bring props and prizes, or do we?", COMMON_PAYMENT_Q] },
    { key: "cake", line: "cake", category: "Cake", onlyFor: ["anniversary"], questions: ["Is eggless available?", "How many servings does this size give?", "When and how will it be delivered?"] },
    { key: "decor", line: "decor", category: "Decorator", questions: ["Can you show photos of this theme?", "How long does setup take?", "Is cleanup included?"] },
    { key: "entertainment", line: "entertainment", category: "Music / DJ / singer", onlyFor: ["anniversary", "other"], questions: ["Is the sound system included?", "Can you play our song list?", "How long is the set, and what are overtime charges?", COMMON_PAYMENT_Q] },
    { key: "photo-video", line: "photo-video", category: "Photographer", onlyFor: ["anniversary", "other"], questions: ["How many hours are covered?", "How many edited photos, and by when?", COMMON_PAYMENT_Q] },
  ],
  community: [
    { key: "venue", line: "venue", category: "Tent house", questions: ["What is included: shamiana, chairs, carpets, lights?", "Who handles setup and teardown, and when?", "Is fire-retardant fabric used?", COMMON_PAYMENT_Q] },
    { key: "sound-lighting", line: "sound-lighting", category: "Sound & lighting", questions: ["What is the speaker wattage for our crowd size?", "Is a generator or power backup included?", "Will an operator stay for the whole event?", COMMON_PAYMENT_Q] },
    { key: "mandali", line: "performers", category: "Bhajan mandali", onlyFor: ["jagran"], questions: ["How many members and instruments?", "What are the start and end times?", "Do you bring your own sound system?", COMMON_PAYMENT_Q] },
    { key: "catering", line: "catering", category: "Food / halwai", onlyFor: ["jagran", "diwali-mela", "rwa-function", "other"], questions: ["What is the per-head rate and minimum count?", "Is the kitchen setup on-site?", "Who supplies utensils and handles leftovers?", COMMON_PAYMENT_Q] },
    { key: "ration", line: "catering", category: "Ration supplier", onlyFor: ["langar"], questions: ["Can you deliver the full order a day early?", "Will unused sealed items be taken back?", "Is there a bulk discount?"] },
    { key: "decor", line: "decor", category: "Decorator / flowers", onlyFor: ["jagran", "rwa-function", "other"], questions: ["Can you share photos of a similar setup?", "Fresh or artificial flowers?", "Who handles setup and removal, and when?", COMMON_PAYMENT_Q] },
    { key: "entertainment", line: "entertainment", category: "Performers / games", onlyFor: ["diwali-mela", "rwa-function", "other"], questions: ["What does the performance include, and for how long?", "Do you need a stage, sound or power from us?", COMMON_PAYMENT_Q] },
    { key: "stalls", line: "stalls", category: "Stall / canopy supplier", onlyFor: ["diwali-mela"], questions: ["What size are the stalls, and what's included (table, light, banner)?", "Who sets up and removes them, and when?", COMMON_PAYMENT_Q] },
    { key: "promotion", line: "promotion", category: "Banner & poster printer", onlyFor: ["diwali-mela"], questions: ["Can we approve a proof before printing?", "How many days for delivery?", "Is installation of banners included?"] },
    { key: "cooking", line: "cooking", category: "Bhatti & cooking equipment on rent", onlyFor: ["langar"], questions: ["What is included: burners, cylinders, large vessels?", "Who delivers and collects, and when?", "Is there a deposit, and how is it returned?"] },
    { key: "utensils", line: "utensils", category: "Utensils & serving on rent", onlyFor: ["langar"], questions: ["How many plates, glasses and serving buckets are included?", "What is charged for breakage or loss?", "When are they delivered and collected?"] },
    { key: "cleanup", line: "cleanup", category: "Cleaning & waste pickup", onlyFor: ["langar"], questions: ["Will you segregate wet and dry waste?", "What time will the team arrive after the event?", "How many people are in the team?"] },
    { key: "logistics", line: "logistics", category: "Transport", onlyFor: ["jagran", "langar", "other"], questions: ["Is the rate per trip or per day, including fuel and tolls?", "Will the vehicle wait during the event?", COMMON_PAYMENT_Q] },
    { key: "safety", line: "safety", category: "Safety & first aid", questions: ["Are fire extinguishers placed near cooking and power areas?", "Is a first-aid kit and a trained volunteer on site?", "Is the nearest hospital route planned?"] },
  ],
};

export function buildVendorChecklist(eventType: EventType, selectors: readonly string[] = []): VendorChecklistItem[] {
  return TEMPLATES[eventType]
    .filter((t) => !t.onlyFor || t.onlyFor.some((s) => selectors.includes(s)))
    .map(({ key, category, questions, line }) => ({ key, category, questions: [...questions], search: SEARCH_TERMS[key] ?? category.toLowerCase(), ...(line ? { line } : {}) }));
}

/** What we search for (Google Maps and "check prices online"), per vendor category key (see engine/vendors.ts). */
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
