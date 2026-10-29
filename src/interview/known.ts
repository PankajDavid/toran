import { z } from "zod";
import { EVENT_TYPES, LIMITS, SUB_TYPES, WEDDING_SUB_EVENTS, type CityTier, type EventType } from "../engine/config.js";
import { addYears, isValidIsoDate } from "../engine/dates.js";
import { DIETS } from "../engine/validate.js";

/**
 * "Known" = everything the interview has learned so far. Every field is optional
 * and is validated on its own, so one bad value (from a user or the AI) is
 * dropped without losing the rest.
 */
export interface Known {
  eventType?: EventType;
  subType?: string;
  subEvents?: string[];
  eventDate?: string;
  /** Set when only a month is known ("Feb mein"); cleared once a full date arrives. */
  eventMonth?: number;
  guestCount?: number;
  totalBudgetINR?: number;
  city?: string;
  cityTier?: CityTier;
  diet?: (typeof DIETS)[number];
}

export const KNOWN_FIELDS = [
  "eventType",
  "subType",
  "subEvents",
  "eventDate",
  "eventMonth",
  "guestCount",
  "totalBudgetINR",
  "city",
  "cityTier",
  "diet",
] as const;
export type KnownField = (typeof KNOWN_FIELDS)[number];

const fieldSchemas = {
  eventType: z.enum(EVENT_TYPES),
  subType: z.string().max(20),
  subEvents: z.array(z.enum(WEDDING_SUB_EVENTS)).min(1).max(WEDDING_SUB_EVENTS.length),
  eventDate: z.string().max(10).refine(isValidIsoDate),
  eventMonth: z.number().int().min(1).max(12),
  guestCount: z.number().int().min(LIMITS.minGuests).max(LIMITS.maxGuests),
  totalBudgetINR: z.number().int().min(LIMITS.minBudgetINR).max(LIMITS.maxBudgetINR),
  city: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[\p{L}\p{M} .'-]+$/u),
  cityTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  diet: z.enum(DIETS),
} satisfies Record<KnownField, z.ZodType>;

/**
 * Keeps only valid fields from untrusted input. Also enforces the rules
 * that span fields: sub-type must belong to the event type, sub-events only
 * for weddings, date not in the past and within the allowed window.
 */
export function sanitizeKnown(raw: unknown, today: string): Known {
  return applyCrossFieldRules(pickValidFields(raw), today);
}

/** Each known field that passes its own schema. Own properties only: never values from an object's prototype. */
function pickValidFields(raw: unknown): Known {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out as Known;
  for (const field of KNOWN_FIELDS) {
    if (!Object.hasOwn(raw, field)) continue;
    const value = (raw as Record<string, unknown>)[field];
    if (value === undefined || value === null) continue;
    const parsed = fieldSchemas[field].safeParse(value);
    if (parsed.success) out[field] = parsed.data;
  }
  return out as Known;
}

/** Rules that span fields: sub-type fits the event type, functions only for weddings, a date in the allowed window. */
function applyCrossFieldRules(k: Known, today: string): Known {
  if (k.subType && (!k.eventType || !SUB_TYPES[k.eventType].includes(k.subType))) delete k.subType;
  if (k.subEvents && k.eventType !== "wedding") delete k.subEvents;
  if (k.subEvents) k.subEvents = [...new Set(k.subEvents)];
  const outOfWindow = k.eventDate && (k.eventDate < today || k.eventDate > addYears(today, LIMITS.maxYearsAhead));
  if (outOfWindow) delete k.eventDate;
  if (k.eventDate) delete k.eventMonth;
  return k;
}

/** Applies newer values over older ones. Changing the event type clears details that belonged to the old type. */
export function mergeKnown(base: Known, update: Known): Known {
  const merged: Known = { ...base };
  if (update.eventType && update.eventType !== base.eventType) {
    delete merged.subType;
    delete merged.subEvents;
  }
  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  if (update.eventMonth && !update.eventDate) delete merged.eventDate;
  if (merged.eventDate) delete merged.eventMonth;
  return merged;
}
