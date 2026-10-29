import { z } from "zod";
import { LIMITS } from "./config.js";
import { AI_INSTRUCTION, EXCLUDED, EXPECTED, EXTRA_COST, FULL_UPFRONT, NON_REFUNDABLE, PER_GUEST_UNIT } from "./data/quote-wording.js";

/**
 * Quote Checker engine. The AI only READS the quotation into lines; the user
 * confirms them; then this plain code does every check. No AI judgement here.
 * The words each check looks for are in data/quote-wording.ts.
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

function lineAmount(l: QuoteLine): number | null {
  if (l.amountINR !== undefined) return l.amountINR;
  if (l.quantity !== undefined && l.rate !== undefined) return Math.round(l.quantity * l.rate);
  return null;
}

/** Money worked out once and shared by the checks. */
interface Totals {
  linesTotalINR: number;
  unpriced: number;
  baseINR: number;
  gstRatePct: number;
  gstINR: number;
  trueTotalINR: number;
  ifGstExtraINR: number | null;
}

/** A line's quantity × rate when all three numbers are written, else null. */
function expectedAmount(l: QuoteLine): number | null {
  return l.quantity === undefined || l.rate === undefined || l.amountINR === undefined ? null : Math.round(l.quantity * l.rate);
}

const differs = (a: number, b: number) => Math.abs(a - b) > 1; // ±₹1 for rounding
const list = (xs: string[]) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
/** Line descriptions and written terms: where items, extras and conditions show up. */
const termsOf = (q: Quote) => [...(q.notes ?? []), ...q.lines.map((l) => l.description)];

function computeTotals(q: Quote, ctx: QuoteContext): Totals {
  const known = q.lines.map(lineAmount);
  const linesTotalINR = known.reduce<number>((a, b) => a + (b ?? 0), 0);
  const unpriced = known.filter((a) => a === null).length;
  const baseINR = q.subtotalINR ?? linesTotalINR;
  const gstRatePct = q.gst.ratePct ?? ctx.assumedGstPct ?? 18;
  if (q.gst.status === "extra") {
    const gstINR = q.gst.amountINR ?? Math.round((baseINR * gstRatePct) / 100);
    return { linesTotalINR, unpriced, baseINR, gstRatePct, gstINR, trueTotalINR: baseINR + gstINR, ifGstExtraINR: null };
  }
  const trueTotalINR = q.totalINR ?? baseINR;
  const ifGstExtraINR = q.gst.status === "included" ? null : trueTotalINR + Math.round((trueTotalINR * gstRatePct) / 100);
  return { linesTotalINR, unpriced, baseINR, gstRatePct, gstINR: 0, trueTotalINR, ifGstExtraINR };
}

/** 1. Each line: quantity × rate must equal the amount. */
function checkLineMath(q: Quote): Finding[] {
  return q.lines.flatMap((l, i) => {
    const expected = expectedAmount(l);
    if (expected === null || l.amountINR === undefined || !differs(expected, l.amountINR)) return [];
    return [
      {
        code: "LINE_MATH",
        severity: "problem" as const,
        message: `Line ${i + 1} (${l.description}): ${num(l.quantity ?? 0)} × ${inr(l.rate ?? 0)} = ${inr(expected)}, but the quote says ${inr(l.amountINR)}. Difference ${inr(Math.abs(l.amountINR - expected))}.`,
        question: `For "${l.description}", ${num(l.quantity ?? 0)} × ${num(l.rate ?? 0)} comes to ${inr(expected)}, but the quote shows ${inr(l.amountINR)}. Could you please check this line?`,
      },
    ];
  });
}

/** 2. Unpriced lines, and the lines against the written subtotal. */
function checkSubtotal(q: Quote, t: Totals): Finding[] {
  const out: Finding[] = [];
  if (t.unpriced) {
    out.push({
      code: "UNPRICED_LINES",
      severity: "warning",
      message: `${t.unpriced} line${t.unpriced === 1 ? " has" : "s have"} no amount, so the total can't be fully checked.`,
      question: "A few items on the quotation don't have a price. Could you share the amount for each?",
    });
  }
  if (q.subtotalINR !== undefined && !t.unpriced && differs(q.subtotalINR, t.linesTotalINR)) {
    out.push({
      code: "SUBTOTAL_MISMATCH",
      severity: "problem",
      message: `The lines add up to ${inr(t.linesTotalINR)}, but the subtotal says ${inr(q.subtotalINR)}. Difference ${inr(Math.abs(q.subtotalINR - t.linesTotalINR))}.`,
      question: `The items on the quotation add up to ${inr(t.linesTotalINR)}, but the subtotal is ${inr(q.subtotalINR)}. Could you please check?`,
    });
  }
  return out;
}

/** 3. GST: extra (what it adds), included, or not mentioned (what it would add); and subtotal + GST = total. */
function checkGst(q: Quote, t: Totals): Finding[] {
  if (q.gst.status === "not-mentioned") {
    return [
      {
        code: "GST_NOT_MENTIONED",
        severity: "warning",
        message: `GST isn't mentioned. If it's added on top at ${num(t.gstRatePct)}%, you'd pay ${inr(t.ifGstExtraINR ?? 0)} instead of ${inr(t.trueTotalINR)}.`,
        question: "Is GST included in this price, or will it be added on top?",
      },
    ];
  }
  const out: Finding[] = [];
  const mismatch = (sub: number, gst: number, total: number): Finding => ({
    code: "TOTAL_MISMATCH",
    severity: "problem",
    message: `Subtotal ${inr(sub)} + GST ${inr(gst)} = ${inr(sub + gst)}, but the total says ${inr(total)}.`,
    question: `Subtotal plus GST comes to ${inr(sub + gst)}, but the total shows ${inr(total)}. Could you confirm the final amount?`,
  });
  if (q.gst.status === "extra") {
    out.push({
      code: "GST_EXTRA",
      severity: "warning",
      message: `GST is extra. At ${num(t.gstRatePct)}%${q.gst.ratePct === undefined ? " (assumed)" : ""}, that's ${inr(t.gstINR)} more: you'd pay ${inr(t.trueTotalINR)}, not ${inr(t.baseINR)}.`,
      question:
        q.gst.ratePct === undefined ? "GST is mentioned as extra. Which GST rate applies, and will you give a GST invoice?" : undefined,
    });
    if (q.totalINR !== undefined && q.gst.amountINR !== undefined && differs(q.totalINR, t.trueTotalINR)) {
      out.push(mismatch(t.baseINR, t.gstINR, q.totalINR));
    }
    return out;
  }
  out.push({ code: "GST_INCLUDED", severity: "good", message: "GST is included in the price." });
  if (
    q.totalINR !== undefined &&
    q.subtotalINR !== undefined &&
    q.gst.amountINR !== undefined &&
    differs(q.subtotalINR + q.gst.amountINR, q.totalINR)
  ) {
    out.push(mismatch(q.subtotalINR, q.gst.amountINR, q.totalINR));
  }
  return out;
}

/** GST split into CGST and SGST is rounded twice, so allow ±₹2. */
const GST_TOLERANCE_INR = 2;

/**
 * The written GST amount and rate, and the amount the rate actually gives. Null unless the quote writes both.
 * Extra: rate × pre-tax amount. Included: rate × subtotal when written, else the GST inside the total.
 */
function gstRateGap(q: Quote, t: Totals): { base: number; expected: number; stated: number } | null {
  const { ratePct, amountINR } = q.gst;
  if (ratePct === undefined || amountINR === undefined || q.gst.status === "not-mentioned") return null;
  let base: number | undefined;
  if (q.gst.status === "extra") base = t.baseINR;
  else if (q.subtotalINR !== undefined) base = q.subtotalINR;
  else if (q.totalINR !== undefined) base = Math.round((q.totalINR * 100) / (100 + ratePct));
  if (base === undefined) return null;
  const expected = Math.round((base * ratePct) / 100);
  return Math.abs(expected - amountINR) > GST_TOLERANCE_INR ? { base, expected, stated: amountINR } : null;
}

/** 3a. The GST amount must match the GST rate: 18% of ₹10,000 is ₹1,800, not ₹3,000. */
function checkGstRate(q: Quote, t: Totals): Finding[] {
  const gap = gstRateGap(q, t);
  if (!gap) return [];
  const rate = num(q.gst.ratePct ?? 0);
  const diff = gap.stated - gap.expected;
  return [
    {
      code: "GST_RATE_MISMATCH",
      severity: "problem",
      message: `GST at ${rate}% on ${inr(gap.base)} is ${inr(gap.expected)}, but the quote says ${inr(gap.stated)} (${inr(Math.abs(diff))} ${diff > 0 ? "more" : "less"}).`,
      question: `${rate}% GST on ${inr(gap.base)} comes to ${inr(gap.expected)}, but the quote shows ${inr(gap.stated)}. Could you correct the GST amount?`,
    },
  ];
}

/** 3b. No subtotal written: the written total must match the items (or items + GST when GST is extra). */
function checkWrittenTotal(q: Quote, t: Totals, already: readonly Finding[]): Finding[] {
  if (q.subtotalINR !== undefined || q.totalINR === undefined || t.unpriced || already.some((f) => f.code === "TOTAL_MISMATCH")) return [];
  const total = q.totalINR;
  const allowed = [t.linesTotalINR, ...(q.gst.status === "extra" ? [t.linesTotalINR + t.gstINR] : [])];
  if (allowed.some((x) => !differs(x, total))) return [];
  const discount = total < t.linesTotalINR;
  return [
    {
      code: "TOTAL_MISMATCH",
      severity: "problem",
      message: `The items add up to ${inr(t.linesTotalINR)}, but the total says ${inr(total)}. Difference ${inr(Math.abs(t.linesTotalINR - total))}.${discount ? " If that's a package discount, get it in writing." : ""}`,
      question: `The items add up to ${inr(t.linesTotalINR)}, but the total shows ${inr(total)}. Which is the final amount${discount ? ", and is the difference a discount" : ""}?`,
    },
  ];
}

/** The per-plate (or per-head) line, if there is one. */
const perGuestLine = (q: Quote) =>
  q.lines.find((l) => l.rate !== undefined && ((l.unit && PER_GUEST_UNIT.test(l.unit)) || PER_GUEST_UNIT.test(l.description)));

/** 4–5. A minimum guarantee above the guest count (priced), and a per-guest line quoted for too few. */
function checkGuests(q: Quote, ctx: QuoteContext): Finding[] {
  const out: Finding[] = [];
  const perGuest = perGuestLine(q);
  const min = q.minimumGuarantee;
  if (min && min.quantity > ctx.guestCount) {
    const extra = min.quantity - ctx.guestCount;
    const cost = perGuest?.rate !== undefined ? Math.round(extra * perGuest.rate) : null;
    out.push({
      code: "MIN_GUARANTEE",
      severity: "warning",
      message: `The quote has a minimum of ${num(min.quantity)} ${min.unit ?? "plates"}, but you expect ${num(ctx.guestCount)} guests. You'd pay for ${num(extra)} that nobody eats${cost !== null ? `: about ${inr(cost)}` : ""}.`,
      question: `We expect about ${num(ctx.guestCount)} guests. Could the minimum guarantee be ${num(ctx.guestCount)} instead of ${num(min.quantity)}?`,
    });
  }
  if (perGuest?.quantity !== undefined && perGuest.rate !== undefined && perGuest.quantity < ctx.guestCount) {
    out.push({
      code: "SHORT_QUANTITY",
      severity: "warning",
      message: `"${perGuest.description}" is quoted for ${num(perGuest.quantity)}, but you expect ${num(ctx.guestCount)} guests. Feeding everyone adds about ${inr((ctx.guestCount - perGuest.quantity) * perGuest.rate)}.`,
      question: `Please quote "${perGuest.description}" for ${num(ctx.guestCount)} guests.`,
    });
  }
  return out;
}

/** 6. Items families assume are included: covered, explicitly excluded, or not mentioned at all. */
function checkExpectedItems(q: Quote): Finding[] {
  const segments = [...q.lines.map((l) => l.description), ...(q.notes ?? [])];
  const missing: string[] = [];
  const excluded: string[] = [];
  for (const e of EXPECTED[q.category] ?? []) {
    const hits = segments.filter((seg) => e.words.test(seg));
    if (!hits.length) missing.push(e.item);
    else if (hits.every((seg) => EXCLUDED.test(seg))) excluded.push(e.item);
  }
  const out: Finding[] = [];
  if (excluded.length) {
    const one = excluded.length === 1;
    out.push({
      code: "EXCLUDED_ITEMS",
      severity: "warning",
      message: `Not included, you arrange and pay: ${excluded.join(", ")}. Budget for ${one ? "it" : "them"} separately.`,
      question: `The quote says ${list(excluded)} ${one ? "is" : "are"} to be arranged by us. Could you quote for ${one ? "it" : "them"} too?`,
    });
  }
  if (missing.length) {
    out.push({
      code: "MISSING_ITEMS",
      severity: "warning",
      message: `Not mentioned: ${missing.join(", ")}. These often cost extra if they're not in writing.`,
      question: `${missing.length === 1 ? "Is" : "Are"} ${list(missing)} included in this price?`,
    });
  }
  return out;
}

/** 6b. Costs outside the total. GST has its own check, and "arranged by party" items are above. */
function checkExtraCharges(q: Quote, t: Totals): Finding[] {
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
  if (!extras.length) return [];
  const quoted = extras.map((x) => `"${x}"`).join(", ");
  return [
    {
      code: "EXTRA_CHARGES",
      severity: "warning",
      message: `Costs outside the total: ${quoted}. The real bill will be higher than ${inr(t.trueTotalINR)}.`,
      question: `The quote says ${quoted}. Could you give a fixed amount for ${extras.length === 1 ? "this" : "each of these"} so we know the full cost?`,
    },
  ];
}

/** 7. Against the planned budget line. */
function checkAgainstPlan(t: Totals, ctx: QuoteContext): Finding[] {
  if (ctx.plannedINR === undefined) return [];
  const gap = t.trueTotalINR - ctx.plannedINR;
  if (gap > 0)
    return [{ code: "OVER_PLAN", severity: "warning", message: `${inr(gap)} over your plan of ${inr(ctx.plannedINR)} for this.` }];
  return [
    {
      code: "WITHIN_PLAN",
      severity: "good",
      message: `Within your plan of ${inr(ctx.plannedINR)}${gap < 0 ? `, with ${inr(-gap)} to spare` : ""}.`,
    },
  ];
}

/** 7b. Hidden instructions to an AI in any line, note or the vendor name: someone tried to trick the reading. */
function checkAiInstructions(q: Quote): Finding[] {
  if (![q.vendorName ?? "", ...termsOf(q)].some((x) => AI_INSTRUCTION.test(x))) return [];
  return [
    {
      code: "AI_INSTRUCTIONS",
      severity: "problem",
      message:
        "This quote contains text addressed to an AI, a sign someone tried to trick the reading. Check every line and the total against the paper before you trust this check.",
      question: "Your quotation has a note addressed to an AI system. Could you send a clean, signed copy of the quote?",
    },
  ];
}

/** Advance above this share of the total is a warning; at or above PROBLEM_ADVANCE_PCT, a problem. */
const HIGH_ADVANCE_PCT = 50;
const PROBLEM_ADVANCE_PCT = 90;

/** The advance as a share of the total. "Full payment before setup" counts as 100%, whatever was extracted. */
function advancePercent(q: Quote, t: Totals): number | undefined {
  if (termsOf(q).some((x) => FULL_UPFRONT.test(x))) return 100;
  if (q.advance?.percent !== undefined) return q.advance.percent;
  if (q.advance?.amountINR !== undefined && t.trueTotalINR > 0) return Math.round((q.advance.amountINR / t.trueTotalINR) * 100);
  return undefined;
}

/** 8. Payment terms: a high advance, a non-refundable advance, or no refund terms at all. */
function checkPayment(q: Quote, t: Totals): Finding[] {
  const out: Finding[] = [];
  const pct = advancePercent(q, t);
  if (pct !== undefined && pct > HIGH_ADVANCE_PCT) {
    const severe = pct >= PROBLEM_ADVANCE_PCT; // paying everything before the work is the riskiest term on any quote
    out.push({
      code: "HIGH_ADVANCE",
      severity: severe ? "problem" : "warning",
      message: severe
        ? `It asks for ${num(pct)}% before the event. If anything goes wrong, you have no money left to hold back.`
        : `The advance is ${num(pct)}%. Paying more than half before the event leaves you little leverage.`,
      question: "Could the advance be lowered to 25–30%, with the rest paid after the event?",
    });
  }
  if (termsOf(q).some((x) => NON_REFUNDABLE.test(x))) {
    out.push({
      code: "NON_REFUNDABLE",
      severity: "problem",
      message: "The advance is non-refundable. If plans change, you lose it all.",
      question:
        "If we have to cancel or change the date, could the advance be adjusted against a new date, or refunded after deducting your actual costs?",
    });
  } else if (!q.refundMentioned) {
    out.push({
      code: "NO_REFUND_TERMS",
      severity: "warning",
      message: "There's no cancellation or refund policy on the quote.",
      question: "Could you share your cancellation and refund policy in writing?",
    });
  }
  return out;
}

/** If any line's maths is wrong: what the total would be with the maths corrected (GST scaled to match). */
function correctedTotal(q: Quote, t: Totals): number | null {
  const overcharge = q.lines.reduce((sum, l) => {
    const expected = expectedAmount(l);
    return expected !== null && l.amountINR !== undefined && differs(expected, l.amountINR) ? sum + (l.amountINR - expected) : sum;
  }, 0);
  const gstGap = gstRateGap(q, t);
  if (overcharge === 0 && !gstGap) return null;
  if (q.gst.status !== "extra") return t.trueTotalINR - overcharge - (gstGap ? gstGap.stated - gstGap.expected : 0);
  const fixedBase = t.baseINR - overcharge;
  // A wrong GST amount is recalculated from the rate; a right one is scaled to the corrected base.
  const gst =
    q.gst.amountINR !== undefined && !gstGap
      ? Math.round((q.gst.amountINR * fixedBase) / Math.max(1, t.baseINR))
      : Math.round((fixedBase * t.gstRatePct) / 100);
  return fixedBase + gst;
}

/**
 * Runs every check on a quote the user has confirmed. Plain code, no AI: each check is a small
 * function, and findings come back in a fixed order with the polite questions to send the vendor.
 */
export function checkQuote(q: Quote, ctx: QuoteContext): QuoteCheck {
  const t = computeTotals(q, ctx);
  const findings: Finding[] = [...checkLineMath(q), ...checkSubtotal(q, t), ...checkGst(q, t), ...checkGstRate(q, t)];
  findings.push(
    ...checkWrittenTotal(q, t, findings),
    ...checkGuests(q, ctx),
    ...checkExpectedItems(q),
    ...checkExtraCharges(q, t),
    ...checkAgainstPlan(t, ctx),
    ...checkAiInstructions(q),
    ...checkPayment(q, t),
  );
  return {
    linesTotalINR: t.linesTotalINR,
    baseINR: t.baseINR,
    gstStatus: q.gst.status,
    gstRatePct: t.gstRatePct,
    gstINR: t.gstINR,
    trueTotalINR: t.trueTotalINR,
    ifGstExtraINR: t.ifGstExtraINR,
    correctedTotalINR: correctedTotal(q, t),
    budgetGapINR: ctx.plannedINR === undefined ? null : t.trueTotalINR - ctx.plannedINR,
    findings,
    questions: findings.map((f) => f.question).filter((x): x is string => !!x),
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
