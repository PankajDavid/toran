import { z } from "zod";
import { LIMITS } from "./config.js";

/**
 * Quote Checker engine. The AI only READS the quotation into lines; the user
 * confirms them; then this plain code does every check. No AI judgement here.
 */

const MAX_INR = LIMITS.maxBudgetINR;
const money = z.number().int("Amounts must be whole rupees").min(0).max(MAX_INR);
const text = (max: number) => z.string().trim().max(max);

export const QuoteLineSchema = z.strictObject({
  description: text(120).min(1, "Each line needs a description"),
  quantity: z.number().min(0).max(100_000).optional(),
  unit: text(20).optional(),
  /** Rate per unit, may have paise (e.g. 649.5). */
  rate: z.number().min(0).max(MAX_INR).optional(),
  amountINR: money.optional(),
});

export const GST_STATUSES = ["included", "extra", "not-mentioned"] as const;

export const QuoteSchema = z.strictObject({
  /** Budget line this quote is for (e.g. "catering", "venue"). */
  category: z.string().regex(/^[a-z][a-z-]{1,29}$/),
  vendorName: text(80).optional(),
  lines: z.array(QuoteLineSchema).min(1, "Add at least one line").max(60),
  subtotalINR: money.optional(),
  gst: z.strictObject({
    status: z.enum(GST_STATUSES),
    ratePct: z.number().min(0).max(28).optional(),
    amountINR: money.optional(),
  }),
  totalINR: money.optional(),
  minimumGuarantee: z.strictObject({ quantity: z.number().int().min(1).max(100_000), unit: text(20).optional() }).optional(),
  advance: z.strictObject({ percent: z.number().min(0).max(100).optional(), amountINR: money.optional() }).optional(),
  refundMentioned: z.boolean().optional(),
  /** Terms and conditions as written (short lines). */
  notes: z.array(text(200)).max(20).optional(),
});

export type QuoteLine = z.infer<typeof QuoteLineSchema>;
export type Quote = z.infer<typeof QuoteSchema>;

export interface QuoteContext {
  guestCount: number;
  /** Planned amount for this budget line, if known. */
  plannedINR?: number;
  /** GST rate to assume when the quote says "extra" without a rate. Default 18%. */
  assumedGstPct?: number;
}

export type FindingSeverity = "problem" | "warning" | "good";

export interface Finding {
  code: string;
  severity: FindingSeverity;
  message: string;
  /** Polite question to send the vendor, if any. */
  question?: string;
}

export interface QuoteCheck {
  /** Sum of the line amounts (using quantity × rate when the amount is missing). */
  linesTotalINR: number;
  /** The subtotal used for the GST calculation. */
  baseINR: number;
  gstStatus: Quote["gst"]["status"];
  gstRatePct: number;
  gstINR: number;
  /** What you will actually pay, including GST when it is extra. */
  trueTotalINR: number;
  /** Shown when GST is not mentioned: the total if it turns out to be extra. */
  ifGstExtraINR: number | null;
  /** When a line's arithmetic is wrong: what the true total would be with correct maths. */
  correctedTotalINR: number | null;
  /** Positive = over the planned budget line. */
  budgetGapINR: number | null;
  findings: Finding[];
  questions: string[];
  /** Counts for comparing quotes. */
  problems: number;
  warnings: number;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { maximumFractionDigits: 2 }));

/** Items families usually assume are included, per budget line. Each: what to ask, and words that show it's covered. */
const EXPECTED: Record<string, { item: string; words: RegExp }[]> = {
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
const PER_GUEST_UNIT = /plate|head|person|pax|guest|cover|thali/i;

function lineAmount(l: QuoteLine): number | null {
  if (l.amountINR !== undefined) return l.amountINR;
  if (l.quantity !== undefined && l.rate !== undefined) return Math.round(l.quantity * l.rate);
  return null;
}

export function checkQuote(q: Quote, ctx: QuoteContext): QuoteCheck {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);

  // 1. Arithmetic on each line: quantity × rate must equal the amount (±₹1 for rounding).
  q.lines.forEach((l, i) => {
    if (l.quantity === undefined || l.rate === undefined || l.amountINR === undefined) return;
    const expected = Math.round(l.quantity * l.rate);
    if (Math.abs(expected - l.amountINR) > 1) {
      add({
        code: "LINE_MATH",
        severity: "problem",
        message: `Line ${i + 1} (${l.description}): ${num(l.quantity)} × ${inr(l.rate)} = ${inr(expected)}, but the quote says ${inr(l.amountINR)}. Difference ${inr(Math.abs(l.amountINR - expected))}.`,
        question: `For "${l.description}", ${num(l.quantity)} × ${num(l.rate)} comes to ${inr(expected)}, but the quote shows ${inr(l.amountINR)}. Could you please check this line?`,
      });
    }
  });

  // 2. Subtotal: the lines must add up to the subtotal written on the quote.
  const known = q.lines.map(lineAmount);
  const linesTotalINR = known.reduce<number>((a, b) => a + (b ?? 0), 0);
  const unpriced = known.filter((a) => a === null).length;
  if (unpriced) {
    add({
      code: "UNPRICED_LINES",
      severity: "warning",
      message: `${unpriced} line${unpriced === 1 ? " has" : "s have"} no amount, so the total can't be fully checked.`,
      question: "A few items on the quotation don't have a price. Could you share the amount for each?",
    });
  }
  if (q.subtotalINR !== undefined && !unpriced && Math.abs(q.subtotalINR - linesTotalINR) > 1) {
    add({
      code: "SUBTOTAL_MISMATCH",
      severity: "problem",
      message: `The lines add up to ${inr(linesTotalINR)}, but the subtotal says ${inr(q.subtotalINR)}. Difference ${inr(Math.abs(q.subtotalINR - linesTotalINR))}.`,
      question: `The items on the quotation add up to ${inr(linesTotalINR)}, but the subtotal is ${inr(q.subtotalINR)}. Could you please check?`,
    });
  }
  const baseINR = q.subtotalINR ?? linesTotalINR;

  // 3. GST.
  const gstRatePct = q.gst.ratePct ?? ctx.assumedGstPct ?? 18;
  let gstINR = 0;
  let trueTotalINR: number;
  let ifGstExtraINR: number | null = null;
  if (q.gst.status === "extra") {
    gstINR = q.gst.amountINR ?? Math.round((baseINR * gstRatePct) / 100);
    const computed = baseINR + gstINR;
    trueTotalINR = computed;
    add({
      code: "GST_EXTRA",
      severity: "warning",
      message: `GST is extra. At ${num(gstRatePct)}%${q.gst.ratePct === undefined ? " (assumed)" : ""}, that's ${inr(gstINR)} more: you'd pay ${inr(computed)}, not ${inr(baseINR)}.`,
      question:
        q.gst.ratePct === undefined ? "GST is mentioned as extra. Which GST rate applies, and will you give a GST invoice?" : undefined,
    });
    if (q.totalINR !== undefined && Math.abs(q.totalINR - computed) > 1 && q.gst.amountINR !== undefined) {
      add({
        code: "TOTAL_MISMATCH",
        severity: "problem",
        message: `Subtotal ${inr(baseINR)} + GST ${inr(gstINR)} = ${inr(computed)}, but the total says ${inr(q.totalINR)}.`,
        question: `Subtotal plus GST comes to ${inr(computed)}, but the total shows ${inr(q.totalINR)}. Could you confirm the final amount?`,
      });
    }
  } else if (q.gst.status === "included") {
    trueTotalINR = q.totalINR ?? baseINR;
    add({ code: "GST_INCLUDED", severity: "good", message: "GST is included in the price." });
    if (q.totalINR !== undefined && q.subtotalINR !== undefined && q.gst.amountINR !== undefined) {
      const computed = q.subtotalINR + q.gst.amountINR;
      if (Math.abs(computed - q.totalINR) > 1) {
        add({
          code: "TOTAL_MISMATCH",
          severity: "problem",
          message: `Subtotal ${inr(q.subtotalINR)} + GST ${inr(q.gst.amountINR)} = ${inr(computed)}, but the total says ${inr(q.totalINR)}.`,
          question: `The subtotal and GST add up to ${inr(computed)}, but the total shows ${inr(q.totalINR)}. Could you confirm the final amount?`,
        });
      }
    }
  } else {
    trueTotalINR = q.totalINR ?? baseINR;
    ifGstExtraINR = trueTotalINR + Math.round((trueTotalINR * gstRatePct) / 100);
    add({
      code: "GST_NOT_MENTIONED",
      severity: "warning",
      message: `GST isn't mentioned. If it's added on top at ${num(gstRatePct)}%, you'd pay ${inr(ifGstExtraINR)} instead of ${inr(trueTotalINR)}.`,
      question: "Is GST included in this price, or will it be added on top?",
    });
  }

  // 3b. No subtotal written: the written total must match the lines (or lines + GST when GST is extra).
  if (q.subtotalINR === undefined && q.totalINR !== undefined && !unpriced && !findings.some((f) => f.code === "TOTAL_MISMATCH")) {
    const fits = [linesTotalINR, ...(q.gst.status === "extra" ? [linesTotalINR + gstINR] : [])].some(
      (x) => Math.abs(x - (q.totalINR ?? 0)) <= 1,
    );
    if (!fits) {
      const diff = Math.abs(linesTotalINR - q.totalINR);
      add({
        code: "TOTAL_MISMATCH",
        severity: "problem",
        message: `The items add up to ${inr(linesTotalINR)}, but the total says ${inr(q.totalINR)}. Difference ${inr(diff)}.${q.totalINR < linesTotalINR ? " If that's a package discount, get it in writing." : ""}`,
        question: `The items add up to ${inr(linesTotalINR)}, but the total shows ${inr(q.totalINR)}. Which is the final amount${q.totalINR < linesTotalINR ? ", and is the difference a discount" : ""}?`,
      });
    }
  }

  // 4. Minimum guarantee vs guest count.
  const perGuest = q.lines.find(
    (l) => l.rate !== undefined && ((l.unit && PER_GUEST_UNIT.test(l.unit)) || PER_GUEST_UNIT.test(l.description)),
  );
  if (q.minimumGuarantee && q.minimumGuarantee.quantity > ctx.guestCount) {
    const extra = q.minimumGuarantee.quantity - ctx.guestCount;
    const cost = perGuest?.rate !== undefined ? Math.round(extra * perGuest.rate) : null;
    add({
      code: "MIN_GUARANTEE",
      severity: "warning",
      message: `The quote has a minimum of ${num(q.minimumGuarantee.quantity)} ${q.minimumGuarantee.unit ?? "plates"}, but you expect ${num(ctx.guestCount)} guests. You'd pay for ${num(extra)} that nobody eats${cost !== null ? `: about ${inr(cost)}` : ""}.`,
      question: `We expect about ${num(ctx.guestCount)} guests. Could the minimum guarantee be ${num(ctx.guestCount)} instead of ${num(q.minimumGuarantee.quantity)}?`,
    });
  }
  // 5. Per-guest line quoted for fewer guests than expected.
  if (perGuest && perGuest.quantity !== undefined && perGuest.quantity < ctx.guestCount && perGuest.rate !== undefined) {
    const short = ctx.guestCount - perGuest.quantity;
    add({
      code: "SHORT_QUANTITY",
      severity: "warning",
      message: `"${perGuest.description}" is quoted for ${num(perGuest.quantity)}, but you expect ${num(ctx.guestCount)} guests. Feeding everyone adds about ${inr(short * perGuest.rate)}.`,
      question: `Please quote "${perGuest.description}" for ${num(ctx.guestCount)} guests.`,
    });
  }

  // 6. Items usually expected: covered, excluded ("to be arranged by party"), or not mentioned at all.
  const segments = [...q.lines.map((l) => l.description), ...(q.notes ?? [])];
  const EXCLUDED =
    /arranged\s+by\s+(the\s+)?(party|client|customer|host|you)|by\s+(the\s+)?(party|client|customer)|not\s+included|excluded|exclusive\s+of|excluding|\bextra\b|chargeable|charged\s+separately|own\s+arrangement/i;
  const missing: string[] = [];
  const excluded: string[] = [];
  for (const e of EXPECTED[q.category] ?? []) {
    const hits = segments.filter((seg) => e.words.test(seg));
    if (!hits.length) missing.push(e.item);
    else if (hits.every((seg) => EXCLUDED.test(seg))) excluded.push(e.item);
  }
  const list = (xs: string[]) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  if (excluded.length) {
    add({
      code: "EXCLUDED_ITEMS",
      severity: "warning",
      message: `Not included, you arrange and pay: ${excluded.join(", ")}. Budget for ${excluded.length === 1 ? "it" : "them"} separately.`,
      question: `The quote says ${list(excluded)} ${excluded.length === 1 ? "is" : "are"} to be arranged by us. Could you quote for ${excluded.length === 1 ? "it" : "them"} too?`,
    });
  }
  if (missing.length) {
    add({
      code: "MISSING_ITEMS",
      severity: "warning",
      message: `Not mentioned: ${missing.join(", ")}. These often cost extra if they're not in writing.`,
      question: `${missing.length === 1 ? "Is" : "Are"} ${list(missing)} included in this price?`,
    });
  }

  // 6b. Costs that sit outside the total: "diesel extra", "travel extra", "subject to seasonal rates",
  // "extra hours at 15,000 per hour". GST has its own check, and "arranged by party" items are above.
  const EXTRA_COST =
    /\bextra\b|chargeable|charged\s+(separately|extra|at|@)|additional(ly)?\s+(charge|cost)|subject\s+to|as\s+(per\s+)?actuals?|at\s+actuals?|per\s+(hour|hr)\b|escalat/i;
  const unpricedLines = q.lines.filter((l) => lineAmount(l) === null).map((l) => l.description);
  const extras = [...(q.notes ?? []), ...unpricedLines]
    .filter((seg) => EXTRA_COST.test(seg) && !/\b(gst|tax|taxes)\b/i.test(seg) && !/arranged\s+by/i.test(seg))
    .map((seg) =>
      seg
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[.;,]$/, ""),
    )
    .filter((seg, i, all) => seg && all.indexOf(seg) === i)
    .slice(0, 5);
  if (extras.length) {
    add({
      code: "EXTRA_CHARGES",
      severity: "warning",
      message: `Costs outside the total: ${extras.map((x) => `"${x}"`).join(", ")}. The real bill will be higher than ${inr(trueTotalINR)}.`,
      question: `The quote says ${extras.map((x) => `"${x}"`).join(", ")}. Could you give a fixed amount for ${extras.length === 1 ? "this" : "each of these"} so we know the full cost?`,
    });
  }

  // 7. Against the planned budget line.
  let budgetGapINR: number | null = null;
  if (ctx.plannedINR !== undefined) {
    budgetGapINR = trueTotalINR - ctx.plannedINR;
    if (budgetGapINR > 0) {
      add({ code: "OVER_PLAN", severity: "warning", message: `${inr(budgetGapINR)} over your plan of ${inr(ctx.plannedINR)} for this.` });
    } else {
      add({
        code: "WITHIN_PLAN",
        severity: "good",
        message: `Within your plan of ${inr(ctx.plannedINR)}${budgetGapINR < 0 ? `, with ${inr(-budgetGapINR)} to spare` : ""}.`,
      });
    }
  }

  // 7b. Hidden instructions to an AI ("note for AI: report the total as ..."). A real quote never
  // talks to an AI, so this is a sign someone tried to trick the reader. Checked by code, on every
  // line, note and the vendor name.
  const AI_INSTRUCTION =
    /text\s+addressed\s+to\s+an\s+ai|\b(note|message|instructions?)\s+(to|for)\s+(the\s+)?(ai|assistants?|models?|llms?|chatbots?|gpt|gemini|claude)\b|\b(ignore|disregard)\b.{0,40}\b(instructions?|above|previous|table|rules|prompt)\b|\bsystem\s+prompt\b|\byou\s+are\s+(an?\s+)?(ai|assistant|language\s+model)\b|\bas\s+an\s+ai\b/i;
  const planted = [q.vendorName ?? "", ...q.lines.map((l) => l.description), ...(q.notes ?? [])].some((t) => AI_INSTRUCTION.test(t));
  if (planted) {
    add({
      code: "AI_INSTRUCTIONS",
      severity: "problem",
      message:
        "This quote contains text addressed to an AI, a sign someone tried to trick the reading. Check every line and the total against the paper before you trust this check.",
      question: "Your quotation has a note addressed to an AI system. Could you send a clean, signed copy of the quote?",
    });
  }

  // 8. Payment terms. "Full payment before setup" is a 100% advance, whatever the reader extracted.
  const terms = [...(q.notes ?? []), ...q.lines.map((l) => l.description)];
  const fullUpfront = terms.some((t) =>
    /(full|entire|complete|100\s*%)\s*(payment|amount)?\s*(in\s+advance|before|prior\s+to|at\s+(the\s+)?time\s+of\s+booking|advance)/i.test(
      t,
    ),
  );
  const advancePct = fullUpfront
    ? 100
    : (q.advance?.percent ??
      (q.advance?.amountINR !== undefined && trueTotalINR > 0 ? Math.round((q.advance.amountINR / trueTotalINR) * 100) : undefined));
  if (advancePct !== undefined && advancePct > 50) {
    add({
      code: "HIGH_ADVANCE",
      // Paying everything before the work is done is the riskiest term on any quote.
      severity: advancePct >= 90 ? "problem" : "warning",
      message:
        advancePct >= 90
          ? `It asks for ${num(advancePct)}% before the event. If anything goes wrong, you have no money left to hold back.`
          : `The advance is ${num(advancePct)}%. Paying more than half before the event leaves you little leverage.`,
      question: `Could the advance be lowered to 25–30%, with the rest paid after the event?`,
    });
  }
  const nonRefundable = terms.some((t) => /non[\s-]?refundable|not\s+refundable|no\s+refunds?|will\s+not\s+be\s+refunded/i.test(t));
  if (nonRefundable) {
    add({
      code: "NON_REFUNDABLE",
      severity: "problem",
      message: "The advance is non-refundable. If plans change, you lose it all.",
      question:
        "If we have to cancel or change the date, could the advance be adjusted against a new date, or refunded after deducting your actual costs?",
    });
  } else if (!q.refundMentioned) {
    add({
      code: "NO_REFUND_TERMS",
      severity: "warning",
      message: "There's no cancellation or refund policy on the quote.",
      question: "Could you share your cancellation and refund policy in writing?",
    });
  }

  // If any line's maths is wrong, what would the vendor's total be with correct maths?
  let correctedTotalINR: number | null = null;
  const overcharge = q.lines.reduce((sum, l) => {
    if (l.quantity === undefined || l.rate === undefined || l.amountINR === undefined) return sum;
    const expected = Math.round(l.quantity * l.rate);
    return Math.abs(expected - l.amountINR) > 1 ? sum + (l.amountINR - expected) : sum;
  }, 0);
  if (overcharge !== 0) {
    const fixedBase = baseINR - overcharge;
    correctedTotalINR =
      q.gst.status === "extra"
        ? fixedBase +
          (q.gst.amountINR !== undefined
            ? Math.round((q.gst.amountINR * fixedBase) / Math.max(1, baseINR))
            : Math.round((fixedBase * gstRatePct) / 100))
        : trueTotalINR - overcharge;
  }

  const questions = findings.map((f) => f.question).filter((x): x is string => !!x);
  return {
    linesTotalINR,
    baseINR,
    gstStatus: q.gst.status,
    gstRatePct,
    gstINR,
    trueTotalINR,
    ifGstExtraINR,
    correctedTotalINR,
    budgetGapINR,
    findings,
    questions,
    problems: findings.filter((f) => f.severity === "problem").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
  };
}

/** Polite WhatsApp message to the vendor with every open question, numbered. */
export function vendorMessage(questions: readonly string[], vendorName?: string): string {
  if (!questions.length) return "";
  const greeting = vendorName ? `Namaste ${vendorName} ji,` : "Namaste,";
  return [
    greeting,
    "Thank you for the quotation. Before we confirm, a few questions:",
    "",
    ...questions.map((q, i) => `${i + 1}. ${q}`),
    "",
    "Thank you!",
  ].join("\n");
}
