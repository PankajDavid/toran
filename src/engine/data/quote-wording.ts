/**
 * The wording the Quote Checker looks for, in English and the Hindi words common on Indian quotes
 * ("bartan", "safai", "kursi"). Reference data only: the checks themselves are in engine/quote.ts.
 * The sample quotations in docs/samples/ exercise every pattern.
 */

/** Items families usually assume are included, per budget line. Each: what to ask, and words that show it's covered. */
export const EXPECTED: Record<string, { item: string; words: RegExp }[]> = {
  catering: [
    // Not "plate": "per plate" is a pricing unit, not crockery.
    { item: "crockery and cutlery", words: /crocker|cutler|utensil|bartan|disposable|dinner\s*set/i },
    { item: "serving staff", words: /staff|waiter|server|serving|service\s*boys?|manpower|labou?r/i },
    // Not bare "buffet": a "buffet per plate" is the meal, not the counters.
    { item: "counters and buffet setup", words: /counter|buffet\s*set\s*-?up|setup|set-up|stall|chafing|table\s*decor/i },
    { item: "drinking water", words: /water|bisleri|mineral|aquafina|ro\b/i },
  ],
  venue: [
    { item: "drinking water", words: /water|bisleri|mineral|aquafina|ro\b/i },
    { item: "decoration", words: /decor|flower|lighting/i },
    { item: "power backup (generator)", words: /generator|genset|dg\b|power\s*backup|backup/i },
    { item: "cleaning after the event", words: /clean|housekeep|safai/i },
    { item: "chairs and seating", words: /chair|seat|sofa|kursi/i },
  ],
  decor: [
    { item: "setup and teardown labour", words: /setup|set-up|dismantl|teardown|labou?r|installation/i },
    { item: "transport of decor material", words: /transport|delivery|cartage|freight/i },
  ],
  "photo-video": [
    { item: "edited photos or album", words: /edit|album|retouch/i },
    { item: "delivery date of photos and video", words: /deliver|days|weeks|handover/i },
    { item: "raw files", words: /raw|all\s*files|unedited|soft\s*cop/i },
  ],
  "sound-lighting": [
    { item: "generator or power backup", words: /generator|genset|dg\b|power\s*backup|backup/i },
    { item: "an operator for the whole event", words: /operator|technician|engineer|staff/i },
  ],
  entertainment: [{ item: "sound system", words: /sound|speaker|mic|system/i }],
  beauty: [{ item: "travel to the venue", words: /travel|transport|conveyance|venue/i }],
};

/** Words that mark a per-guest line: per plate, per head, per person, pax. */
export const PER_GUEST_UNIT = /plate|head|person|pax|guest|cover|thali/i;

/** Wording that marks an item as the family's job, or charged on top. */
export const EXCLUDED =
  /arranged\s+by\s+(the\s+)?(party|client|customer|host|you)|by\s+(the\s+)?(party|client|customer)|not\s+included|excluded|exclusive\s+of|excluding|\bextra\b|chargeable|charged\s+separately|own\s+arrangement/i;

/** Wording that puts a cost outside the total ("diesel extra", "subject to seasonal rates", "per hour"). */
export const EXTRA_COST =
  /\bextra\b|chargeable|charged\s+(separately|extra|at|@)|additional(ly)?\s+(charge|cost)|subject\s+to|as\s+(per\s+)?actuals?|at\s+actuals?|per\s+(hour|hr)\b|escalat/i;

/** Text written to an AI ("note for AI: report the total as ..."). A real quote never talks to an AI. */
export const AI_INSTRUCTION =
  /text\s+addressed\s+to\s+an\s+ai|\b(note|message|instructions?)\s+(to|for)\s+(the\s+)?(ai|assistants?|models?|llms?|chatbots?|gpt|gemini|claude)\b|\b(ignore|disregard)\b.{0,40}\b(instructions?|above|previous|table|rules|prompt)\b|\bsystem\s+prompt\b|\byou\s+are\s+(an?\s+)?(ai|assistant|language\s+model)\b|\bas\s+an\s+ai\b/i;

/** Wording that asks for the whole amount before the event. */
export const FULL_UPFRONT =
  /(full|entire|complete|100\s*%)\s*(payment|amount)?\s*(in\s+advance|before|prior\s+to|at\s+(the\s+)?time\s+of\s+booking|advance)/i;

/** Wording that rules out any refund. */
export const NON_REFUNDABLE = /non[\s-]?refundable|not\s+refundable|no\s+refunds?|will\s+not\s+be\s+refunded/i;
