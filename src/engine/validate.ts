import { z } from "zod";
import { BIRTHDAY_KINDS, COMMUNITY_KINDS, LIMITS, WEDDING_STYLES, WEDDING_SUB_EVENTS } from "./config.js";
import { addYears, isValidIsoDate } from "./dates.js";

const common = {
  totalBudgetINR: z
    .number({ error: "Budget must be a number" })
    .int("Budget must be in whole rupees")
    .min(LIMITS.minBudgetINR, `Budget must be at least ₹${LIMITS.minBudgetINR.toLocaleString("en-IN")}`)
    .max(LIMITS.maxBudgetINR, "Budget can be at most ₹5 crore"),
  guestCount: z
    .number({ error: "Guest count must be a number" })
    .int("Guest count must be a whole number")
    .min(LIMITS.minGuests, "At least 1 guest is needed")
    .max(LIMITS.maxGuests, `At most ${LIMITS.maxGuests.toLocaleString("en-IN")} guests`),
  cityTier: z.union([z.literal(1), z.literal(2), z.literal(3)], { error: "City tier must be 1, 2 or 3" }),
  eventDate: z.string().max(10).refine(isValidIsoDate, "Event date must be a real date in YYYY-MM-DD format"),
};

const inputSchema = z.discriminatedUnion(
  "eventType",
  [
    z.strictObject({
      eventType: z.literal("wedding"),
      subType: z.enum(WEDDING_STYLES),
      subEvents: z.array(z.enum(WEDDING_SUB_EVENTS)).min(1, "Pick at least one wedding function").max(WEDDING_SUB_EVENTS.length),
      ...common,
    }),
    z.strictObject({ eventType: z.literal("birthday"), subType: z.enum(BIRTHDAY_KINDS), ...common }),
    z.strictObject({ eventType: z.literal("community"), subType: z.enum(COMMUNITY_KINDS), ...common }),
  ],
  { error: "Event type must be wedding, birthday or community" },
);

export type PlanInput = z.infer<typeof inputSchema>;

export class PlanInputError extends Error {
  constructor(public readonly issues: { field: string; message: string }[]) {
    super("Invalid plan input");
    this.name = "PlanInputError";
  }
}

/**
 * Validates untrusted input. `today` is passed in (not read from the clock)
 * so tests are repeatable and the date window is checked against India time.
 */
export function parsePlanInput(raw: unknown, today: string): PlanInput {
  const result = inputSchema.safeParse(raw);
  if (!result.success) {
    throw new PlanInputError(
      result.error.issues.map((i) => ({ field: i.path.join(".") || "input", message: i.message })),
    );
  }
  const input = result.data;
  if (input.eventDate < today) {
    throw new PlanInputError([{ field: "eventDate", message: "Event date cannot be in the past" }]);
  }
  if (input.eventDate > addYears(today, LIMITS.maxYearsAhead)) {
    throw new PlanInputError([{ field: "eventDate", message: `Event date must be within ${LIMITS.maxYearsAhead} years` }]);
  }
  if (input.eventType === "wedding") {
    input.subEvents = [...new Set(input.subEvents)];
  }
  return input;
}
