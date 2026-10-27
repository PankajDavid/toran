import type { CityTier, EventType } from "../engine/config.js";
import { fromDayNumber, isValidIsoDate, toDayNumber } from "../engine/dates.js";
import type { Known, KnownField } from "./known.js";

/**
 * Rule-based reader for how Indian families describe events, in English,
 * Hindi-in-Roman-script, or a mix ("300 log, 15 lakh, Feb mein").
 * It handles most answers instantly and for free; the AI is only asked
 * about what this misses. Everything it returns is re-validated by sanitizeKnown.
 */

export interface LocalParse {
  fields: Known;
  /** Fields that were inferred rather than stated, to be highlighted for confirmation. */
  guessed: KnownField[];
}

const MONTHS: [RegExp, number][] = [
  [/\b(jan|january|janvari|janwari)\b/, 1],
  [/\b(feb|february|farvari|farwari|febuary)\b/, 2],
  [/\b(mar|march)\b/, 3],
  [/\b(apr|april|aprail)\b/, 4],
  [/\b(may|mai)\b/, 5],
  [/\b(jun|june|joon)\b/, 6],
  [/\b(jul|july|julai)\b/, 7],
  [/\b(aug|august|agast)\b/, 8],
  [/\b(sep|sept|september|sitambar)\b/, 9],
  [/\b(oct|october|aktubar|october)\b/, 10],
  [/\b(nov|november|navambar)\b/, 11],
  [/\b(dec|december|disambar)\b/, 12],
];
const MONTH_ALT =
  "jan|january|janvari|janwari|feb|february|farvari|farwari|febuary|mar|march|apr|april|aprail|may|mai|jun|june|joon|jul|july|julai|aug|august|agast|sep|sept|september|sitambar|oct|october|aktubar|nov|november|navambar|dec|december|disambar";

function monthOf(word: string): number | undefined {
  for (const [re, m] of MONTHS) if (re.test(word)) return m;
  return undefined;
}

/** Next occurrence of day/month on or after today; explicit year respected. */
function resolveDate(day: number, month: number, year: number | undefined, today: string): string | undefined {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (year !== undefined) {
    const y = year < 100 ? 2000 + year : year;
    const iso = `${y}-${pad(month)}-${pad(day)}`;
    return isValidIsoDate(iso) ? iso : undefined;
  }
  const thisYear = Number(today.slice(0, 4));
  for (const y of [thisYear, thisYear + 1]) {
    const iso = `${y}-${pad(month)}-${pad(day)}`;
    if (isValidIsoDate(iso) && iso >= today) return iso;
  }
  return undefined;
}

function parseDate(t: string, today: string): { eventDate?: string; eventMonth?: number } {
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m && isValidIsoDate(m[0])) return { eventDate: m[0] };

  // Indian order: day/month/year. The year is required, so "1.5 lakh" or a range
  // like "10-12 lakh" can never be read as a date.
  m = t.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/);
  if (m) {
    const d = resolveDate(Number(m[1]), Number(m[2]), Number(m[3]), today);
    if (d) return { eventDate: d };
  }

  m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${MONTH_ALT})\\b(?:\\s*,?\\s*(\\d{4}))?`));
  if (m) {
    const d = resolveDate(Number(m[1]), monthOf(m[2])!, m[3] ? Number(m[3]) : undefined, today);
    if (d) return { eventDate: d };
  }
  m = t.match(new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*,?\\s*(\\d{4}))?`));
  if (m) {
    const d = resolveDate(Number(m[2]), monthOf(m[1])!, m[3] ? Number(m[3]) : undefined, today);
    if (d) return { eventDate: d };
  }

  if (/\b(kal|tomorrow)\b/.test(t)) return { eventDate: fromDayNumber(toDayNumber(today) + 1) };

  m = t.match(new RegExp(`\\b(${MONTH_ALT})\\b`));
  // "may" is also an English word; only accept it as a month next to a date-ish cue.
  if (m && !(m[1] === "may" && !/\b(may|mai)\s+(mein|me|month|\d{4})\b/.test(t))) {
    return { eventMonth: monthOf(m[1]) };
  }
  return {};
}

const UNIT: Record<string, number> = {
  crore: 1e7, crores: 1e7, cr: 1e7, karod: 1e7, karor: 1e7,
  lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, lakh_: 1e5, l: 1e5,
  k: 1e3, thousand: 1e3, hazaar: 1e3, hazar: 1e3, hajar: 1e3,
};
const UNIT_ALT = "crores?|cr|karod|karor|lakhs?|lacs?|l|k|thousand|hazaar|hazar|hajar";
const WORD_NUM: Record<string, number> = { sava: 1.25, dedh: 1.5, derh: 1.5, dhai: 2.5, adha: 0.5, aadha: 0.5, ek: 1, do: 2, teen: 3, char: 4, paanch: 5, panch: 5, das: 10 };

const GUEST_WORDS = "log|logon|logo|guests?|people|persons?|pax|mehmaan|mehman|members|bande|admi|janta|families";

function parseGuests(t: string): number | undefined {
  let m = t.match(new RegExp(`\\b(\\d{1,5})\\s*\\+?\\s*(?:${GUEST_WORDS})\\b`));
  if (m) return Number(m[1]);
  m = t.match(new RegExp(`\\b(?:${GUEST_WORDS})\\s*[:=-]?\\s*(?:around|about|approx|lagbhag)?\\s*(\\d{1,5})\\b`));
  if (m) return Number(m[1]);
  return undefined;
}

function parseBudget(t: string): number | undefined {
  const candidates: number[] = [];
  for (const m of t.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALT})\\b`, "g"))) {
    const unit = m[2].replace(/s$/, "");
    candidates.push(Number(m[1]) * (UNIT[unit] ?? UNIT[m[2]] ?? 1));
  }
  for (const m of t.matchAll(new RegExp(`\\b(${Object.keys(WORD_NUM).join("|")})\\s+(${UNIT_ALT})\\b`, "g"))) {
    const unit = m[2].replace(/s$/, "");
    candidates.push(WORD_NUM[m[1]] * (UNIT[unit] ?? UNIT[m[2]] ?? 1));
  }
  for (const m of t.matchAll(/(?:₹|\brs\.?|\binr|\brupees?)\s*([\d,]+(?:\.\d+)?)/g)) candidates.push(Number(m[1].replace(/,/g, "")));
  for (const m of t.matchAll(/\b(\d{1,3}(?:,\d{2,3})+|\d{4,9})\s*(?:\/-|rs\b|rupees?\b)/g)) candidates.push(Number(m[1].replace(/,/g, "")));
  const valid = candidates.filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.round(n));
  return valid.length ? Math.max(...valid) : undefined;
}

const EVENT_RULES: { re: RegExp; eventType: EventType; subType?: string }[] = [
  { re: /\b(kitty)\b/, eventType: "party", subType: "kitty" },
  { re: /\b(anniversary|saalgirah|salgirah)\b/, eventType: "party", subType: "anniversary" },
  { re: /\b(jagran|jagrata|chowki|chauki)\b/, eventType: "community", subType: "jagran" },
  { re: /\b(langar|bhandara)\b/, eventType: "community", subType: "langar" },
  { re: /\b(diwali|deepawali|mela)\b/, eventType: "community", subType: "diwali-mela" },
  { re: /\b(rwa|society function|society event|colony function)\b/, eventType: "community", subType: "rwa-function" },
  { re: /\b(shaadi|shadi|wedding|vivah|marriage|byah|biyah|anand karaj)\b/, eventType: "wedding" },
  { re: /\b(birthday|bday|b'day|janamdin|janmdin|janmadin)\b/, eventType: "birthday" },
];

const STYLE_RULES: [RegExp, string][] = [
  [/\b(punjabi|sikh|anand karaj)\b/, "punjabi"],
  [/\b(south indian|tamil|telugu|kannada|malayali|kerala|tamilian)\b/, "south-indian"],
  [/\b(bengali|bangali)\b/, "bengali"],
  [/\b(christian|church)\b/, "christian"],
];

const SUB_EVENT_RULES: [RegExp, string][] = [
  [/\bhaldi\b/, "haldi"],
  [/\b(mehendi|mehndi|mehandi)\b/, "mehendi"],
  [/\bsangeet\b/, "sangeet"],
  [/\b(ceremony|pheras?|phere|anand karaj|church wedding|vivah)\b/, "ceremony"],
  [/\breception\b/, "reception"],
];

/** Common Indian cities with a tier: 1 = metro, 2 = large city. Unlisted cities are asked about. */
export const CITY_TIERS: Record<string, CityTier> = {
  delhi: 1, "new delhi": 1, mumbai: 1, bombay: 1, "navi mumbai": 1, thane: 1, bengaluru: 1, bangalore: 1,
  chennai: 1, madras: 1, kolkata: 1, calcutta: 1, hyderabad: 1, pune: 1, ahmedabad: 1,
  gurugram: 1, gurgaon: 1, noida: 1, ghaziabad: 1, faridabad: 1,
  chandigarh: 2, panchkula: 2, mohali: 2, zirakpur: 2, ludhiana: 2, amritsar: 2, jalandhar: 2, patiala: 2,
  ambala: 2, karnal: 2, panipat: 2, shimla: 2, jammu: 2, srinagar: 2, dehradun: 2, jaipur: 2, jodhpur: 2,
  udaipur: 2, lucknow: 2, kanpur: 2, agra: 2, varanasi: 2, meerut: 2, indore: 2, bhopal: 2, nagpur: 2,
  nashik: 2, aurangabad: 2, surat: 2, vadodara: 2, rajkot: 2, goa: 2, kochi: 2, thiruvananthapuram: 2,
  coimbatore: 2, madurai: 2, mysuru: 2, mysore: 2, mangaluru: 2, visakhapatnam: 2, vijayawada: 2,
  patna: 2, ranchi: 2, bhubaneswar: 2, raipur: 2, guwahati: 2,
};

/** Regional wedding style a city suggests. Always marked as a guess for the user to confirm. */
const CITY_STYLE: Record<string, string> = {
  chandigarh: "punjabi", panchkula: "punjabi", mohali: "punjabi", zirakpur: "punjabi", ludhiana: "punjabi",
  amritsar: "punjabi", jalandhar: "punjabi", patiala: "punjabi",
  kolkata: "bengali", calcutta: "bengali",
  chennai: "south-indian", madras: "south-indian", hyderabad: "south-indian", bengaluru: "south-indian",
  bangalore: "south-indian", kochi: "south-indian", coimbatore: "south-indian", madurai: "south-indian",
  thiruvananthapuram: "south-indian", visakhapatnam: "south-indian", vijayawada: "south-indian",
};

const CITY_NAMES = Object.keys(CITY_TIERS).sort((a, b) => b.length - a.length);

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export function parseLocal(text: string, today: string, context: { asking?: KnownField; known?: Known } = {}): LocalParse {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 500);
  const fields: Known = {};
  const guessed: KnownField[] = [];
  if (!t) return { fields, guessed };

  for (const rule of EVENT_RULES) {
    if (rule.re.test(t)) {
      fields.eventType = rule.eventType;
      if (rule.subType) fields.subType = rule.subType;
      break;
    }
  }
  const eventType = fields.eventType ?? context.known?.eventType;

  if (eventType === "wedding") {
    for (const [re, style] of STYLE_RULES) if (re.test(t)) { fields.subType = style; break; }
    const subs = SUB_EVENT_RULES.filter(([re]) => re.test(t)).map(([, s]) => s);
    if (subs.length) fields.subEvents = subs;
  }
  if (eventType === "birthday") {
    if (/\b(25th|40th|50th|60th|70th|75th|80th|silver|golden|milestone)\b/.test(t)) fields.subType = "milestone";
    else if (/\b(beta|beti|son|daughter|bachch?[ae]|baby|kid|kids|bete)\b/.test(t)) fields.subType = "kid";
    else if (/\b(my|mera|meri|husband|wife|pati|patni|friend|dost)\b/.test(t)) fields.subType = "adult";
  }

  const date = parseDate(t, today);
  Object.assign(fields, date);

  const guests = parseGuests(t);
  if (guests !== undefined) fields.guestCount = guests;

  let budget = parseBudget(t);
  // A bare number answering a direct question.
  const bare = t.match(/^(?:about|around|approx|lagbhag|~)?\s*(\d[\d,]*)\s*$/);
  if (bare) {
    const n = Number(bare[1].replace(/,/g, ""));
    if (context.asking === "guestCount" && guests === undefined) fields.guestCount = n;
    if (context.asking === "totalBudgetINR" && budget === undefined) {
      if (n >= 1000) budget = n;
      else if (n > 0 && n <= 500) {
        budget = n * 1e5; // "15" while asking budget most likely means 15 lakh — flagged as a guess
        guessed.push("totalBudgetINR");
      }
    }
  }
  if (budget !== undefined) fields.totalBudgetINR = budget;

  const city = CITY_NAMES.find((c) => new RegExp(`\\b${c}\\b`).test(t));
  if (city) {
    fields.city = titleCase(city);
    fields.cityTier = CITY_TIERS[city];
    if (eventType === "wedding" && !fields.subType && !context.known?.subType && CITY_STYLE[city]) {
      fields.subType = CITY_STYLE[city];
      guessed.push("subType");
    }
  } else if (context.asking === "city") {
    const name = text.trim().match(/^[\p{L}\p{M} .'-]{2,60}$/u);
    if (name) fields.city = titleCase(name[0].trim().toLowerCase());
  }

  if (/\bjain\b/.test(t)) fields.diet = "jain";
  else if (/\b(veg (and|aur|&|\+) non[\s-]?veg|both veg)\b/.test(t)) fields.diet = "mixed";
  else if (/\b(non[\s-]?veg|nonveg|chicken|mutton|fish)\b/.test(t)) fields.diet = "non-veg";
  else if (/\b(pure veg|veg only|vegetarian|shakahari|veg)\b/.test(t)) fields.diet = "veg";

  return { fields, guessed };
}
