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
}

export interface VendorChecklistItem {
  key: string;
  category: string;
  questions: string[];
}

const COMMON_PAYMENT_Q = "What is the advance amount, payment schedule and cancellation / refund policy (in writing)?";

const TEMPLATES: Record<EventType, VendorTemplate[]> = {
  wedding: [
    { key: "venue", category: "Venue", questions: ["Is the date available, and is there a backup indoor space if it rains?", "What is included: power backup, parking, rooms, cleaning?", "Are outside caterers and decorators allowed, and is there a fee?", "What is the music cut-off time?", COMMON_PAYMENT_Q] },
    { key: "catering", category: "Caterer", questions: ["Can we do a tasting before booking?", "What is the per-plate rate and the minimum guaranteed count?", "How do you handle extra guests on the day?", "Are serving staff, crockery and counters included?", COMMON_PAYMENT_Q] },
    { key: "photo-video", category: "Photographer & videographer", questions: ["Can we see two full wedding albums, not just highlights?", "How many people, hours and events are covered?", "When will we get edited photos and the film, and in what format?", "Who owns the raw files?", COMMON_PAYMENT_Q] },
    { key: "decor", category: "Decorator", questions: ["Can you share photos of setups you did at our venue?", "Are fresh or artificial flowers quoted?", "What is the setup and teardown time?", COMMON_PAYMENT_Q] },
    { key: "beauty", category: "Makeup artist", questions: ["Can we book a trial session?", "Which products and brands do you use?", "How many family members can you cover and by what time?", COMMON_PAYMENT_Q] },
    { key: "mehendi", category: "Mehendi artist", onlyFor: ["mehendi"], questions: ["Is the henna natural and chemical-free?", "How many guests can your team cover per hour?", "Is the bride's design priced separately?", COMMON_PAYMENT_Q] },
    { key: "entertainment", category: "DJ / dhol / band", onlyFor: ["sangeet", "reception"], questions: ["Is sound and lighting equipment included?", "Can you play our song list and take requests?", "How long is the set, and what are overtime charges?", COMMON_PAYMENT_Q] },
    { key: "pandit", category: "Officiant (pandit / priest / pastor)", onlyFor: ["ceremony"], questions: ["Which rituals will you perform and how long will the ceremony take?", "What samagri should the family arrange?", "Will you explain the rituals to guests?"] },
  ],
  birthday: [
    { key: "venue", category: "Venue", questions: ["Is the space child-safe (if a kids' party)?", "Can we bring our own cake and decor?", "What are the time slot and overtime charges?", COMMON_PAYMENT_Q] },
    { key: "catering", category: "Food", questions: ["Is there a kids' menu and an adults' menu?", "Can you label common allergens?", "What is the per-head rate and minimum order?", COMMON_PAYMENT_Q] },
    { key: "cake", category: "Cake", questions: ["Is eggless available?", "How many servings does this size give?", "When and how will it be delivered?"] },
    { key: "entertainment", category: "Entertainer / games", questions: ["What age group is the act designed for?", "How long is the show, and what space do you need?", "Do you bring your own sound system?", COMMON_PAYMENT_Q] },
    { key: "decor", category: "Decorator", questions: ["Can you show photos of this theme?", "How long does setup take?", "Are balloons and props reused or new?"] },
  ],
  party: [
    { key: "venue", category: "Venue (café, restaurant or hall)", questions: ["Is there a private section for our group size?", "Is there a minimum spend or per-head package?", "Can we bring our own decor and music?", COMMON_PAYMENT_Q] },
    { key: "catering", category: "Food", questions: ["Is there a fixed menu or can we choose dishes?", "Are taxes and service charge included in the quote?", "What is the minimum order?"] },
    { key: "games-host", category: "Games host / anchor", onlyFor: ["kitty"], questions: ["Which games do you run, and for how long?", "Do you bring props and prizes, or do we?", COMMON_PAYMENT_Q] },
    { key: "cake", category: "Cake", onlyFor: ["anniversary"], questions: ["Is eggless available?", "How many servings does this size give?", "When and how will it be delivered?"] },
    { key: "decor", category: "Decorator", questions: ["Can you show photos of this theme?", "How long does setup take?", "Is cleanup included?"] },
  ],
  community: [
    { key: "venue", category: "Tent house", questions: ["What is included: shamiana, chairs, carpets, lights?", "Who handles setup and teardown, and when?", "Is fire-retardant fabric used?", COMMON_PAYMENT_Q] },
    { key: "sound-lighting", category: "Sound & lighting", questions: ["What is the speaker wattage for our crowd size?", "Is a generator or power backup included?", "Will an operator stay for the whole event?", COMMON_PAYMENT_Q] },
    { key: "mandali", category: "Bhajan mandali", onlyFor: ["jagran"], questions: ["How many members and instruments?", "What are the start and end times?", "Do you bring your own sound system?", COMMON_PAYMENT_Q] },
    { key: "catering", category: "Food / halwai", onlyFor: ["jagran", "diwali-mela", "rwa-function", "other"], questions: ["What is the per-head rate and minimum count?", "Is the kitchen setup on-site?", "Who supplies utensils and handles leftovers?", COMMON_PAYMENT_Q] },
    { key: "ration", category: "Ration supplier", onlyFor: ["langar"], questions: ["Can you deliver the full order a day early?", "Will unused sealed items be taken back?", "Is there a bulk discount?"] },
    { key: "safety", category: "Safety & first aid", questions: ["Are fire extinguishers placed near cooking and power areas?", "Is a first-aid kit and a trained volunteer on site?", "Is the nearest hospital route planned?"] },
  ],
};

export function buildVendorChecklist(eventType: EventType, selectors: readonly string[] = []): VendorChecklistItem[] {
  return TEMPLATES[eventType]
    .filter((t) => !t.onlyFor || t.onlyFor.some((s) => selectors.includes(s)))
    .map(({ key, category, questions }) => ({ key, category, questions: [...questions] }));
}
