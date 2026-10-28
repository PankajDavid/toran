import { describe, expect, it } from "vitest";
import { checkQuote, QuoteSchema, vendorMessage, type Quote } from "./quote.js";

// A typical caterer quote, as families receive them.
const caterer = (over: Partial<Quote> = {}): Quote => ({
  category: "catering",
  vendorName: "Sample Caterers",
  lines: [
    { description: "Veg buffet per plate", quantity: 300, unit: "plate", rate: 650, amountINR: 1_95_000 },
    { description: "Live chaat counter", quantity: 1, rate: 15_000, amountINR: 15_000 },
    { description: "Crockery, cutlery and serving staff", amountINR: 10_000 },
    { description: "Mineral water bottles", quantity: 300, rate: 20, amountINR: 6_000 },
  ],
  subtotalINR: 2_26_000,
  gst: { status: "included" },
  totalINR: 2_26_000,
  refundMentioned: true,
  ...over,
});
const ctx = { guestCount: 300, plannedINR: 2_40_000 };
const codes = (q: Quote, c = ctx) => checkQuote(q, c).findings.map((f) => f.code);

describe("a clean quote", () => {
  it("passes with no problems and stays within plan", () => {
    const r = checkQuote(caterer(), ctx);
    expect(r.problems).toBe(0);
    expect(r.trueTotalINR).toBe(2_26_000);
    expect(r.budgetGapINR).toBe(-14_000);
    expect(codes(caterer())).toEqual(["GST_INCLUDED", "WITHIN_PLAN"]);
  });
});

describe("arithmetic", () => {
  it("catches a line where quantity × rate ≠ amount (the concept-doc example)", () => {
    const q = caterer({
      lines: [
        { description: "Veg buffet per plate", quantity: 250, unit: "plate", rate: 650, amountINR: 1_72_500 },
        ...caterer().lines.slice(1),
      ],
    });
    const f = checkQuote(q, { guestCount: 250 }).findings.find((x) => x.code === "LINE_MATH")!;
    expect(f.severity).toBe("problem");
    expect(f.message).toContain("₹1,62,500");
    expect(f.message).toContain("₹1,72,500");
    expect(f.message).toContain("Difference ₹10,000");
  });

  it("works out the total with the maths corrected, including GST", () => {
    const q = caterer({
      lines: [{ description: "Veg buffet per plate", quantity: 250, unit: "plate", rate: 650, amountINR: 1_72_500 }],
      subtotalINR: 1_72_500,
      gst: { status: "extra" },
      totalINR: undefined,
    });
    const r = checkQuote(q, { guestCount: 250 });
    expect(r.trueTotalINR).toBe(2_03_550); // 1,72,500 + 18%
    expect(r.correctedTotalINR).toBe(1_91_750); // 1,62,500 + 18%
    expect(checkQuote(caterer(), ctx).correctedTotalINR).toBeNull();
  });

  it("asks 'Are … included' for several missing items and 'Is … included' for one", () => {
    const many = checkQuote(
      caterer({
        lines: [{ description: "Veg buffet per plate", quantity: 300, unit: "plate", rate: 650, amountINR: 1_95_000 }],
        subtotalINR: 1_95_000,
        totalINR: 1_95_000,
      }),
      ctx,
    );
    expect(many.questions.some((x) => x.startsWith("Are crockery"))).toBe(true);
  });

  it("allows ₹1 rounding on decimal rates", () => {
    const q = caterer({
      lines: [{ description: "Sweets per plate", quantity: 3, unit: "plate", rate: 33.33, amountINR: 100 }],
      subtotalINR: undefined,
      totalINR: undefined,
    });
    expect(codes(q)).not.toContain("LINE_MATH");
  });

  it("catches lines that don't add up to the subtotal", () => {
    expect(codes(caterer({ subtotalINR: 2_36_000 }))).toContain("SUBTOTAL_MISMATCH");
  });

  it("uses quantity × rate when a line has no amount", () => {
    const q = caterer({
      lines: [{ description: "Veg buffet per plate", quantity: 300, unit: "plate", rate: 650 }],
      subtotalINR: undefined,
      totalINR: undefined,
    });
    expect(checkQuote(q, ctx).linesTotalINR).toBe(1_95_000);
  });

  it("flags lines with no price at all", () => {
    const q = caterer({ lines: [...caterer().lines, { description: "Decor at buffet" }], subtotalINR: undefined });
    expect(codes(q)).toContain("UNPRICED_LINES");
    expect(codes(q)).not.toContain("SUBTOTAL_MISMATCH");
  });
});

describe("GST", () => {
  it("adds 18% when GST is extra with no rate, and says the rate was assumed", () => {
    const r = checkQuote(caterer({ gst: { status: "extra" }, totalINR: undefined }), ctx);
    expect(r.gstINR).toBe(40_680);
    expect(r.trueTotalINR).toBe(2_66_680);
    expect(r.findings.find((f) => f.code === "GST_EXTRA")!.message).toContain("(assumed)");
    expect(r.budgetGapINR).toBe(26_680); // was "within plan" before GST
    expect(codes(caterer({ gst: { status: "extra" }, totalINR: undefined }))).toContain("OVER_PLAN");
  });

  it("uses the stated GST rate and amount", () => {
    const r = checkQuote(caterer({ gst: { status: "extra", ratePct: 5, amountINR: 11_300 }, totalINR: 2_37_300 }), ctx);
    expect(r.trueTotalINR).toBe(2_37_300);
    expect(r.findings.map((f) => f.code)).not.toContain("TOTAL_MISMATCH");
  });

  it("catches a total that doesn't equal subtotal + GST", () => {
    expect(codes(caterer({ gst: { status: "extra", ratePct: 5, amountINR: 11_300 }, totalINR: 2_47_300 }))).toContain("TOTAL_MISMATCH");
  });

  it("when GST isn't mentioned, shows what it would cost if added", () => {
    const r = checkQuote(caterer({ gst: { status: "not-mentioned" } }), ctx);
    expect(r.ifGstExtraINR).toBe(2_66_680);
    expect(r.questions).toContain("Is GST included in this price, or will it be added on top?");
  });
});

describe("guests and minimums", () => {
  it("prices the empty plates when the minimum guarantee is above the guest count", () => {
    const f = checkQuote(caterer({ minimumGuarantee: { quantity: 350, unit: "plates" } }), ctx).findings.find(
      (x) => x.code === "MIN_GUARANTEE",
    )!;
    expect(f.message).toContain("50 that nobody eats: about ₹32,500");
    expect(f.question).toContain("300 instead of 350");
  });

  it("no warning when the minimum is at or below the guest count", () => {
    expect(codes(caterer({ minimumGuarantee: { quantity: 250 } }))).not.toContain("MIN_GUARANTEE");
  });

  it("flags a per-plate line quoted for fewer guests than expected", () => {
    const f = checkQuote(caterer(), { guestCount: 400 }).findings.find((x) => x.code === "SHORT_QUANTITY")!;
    expect(f.message).toContain("about ₹65,000");
  });
});

describe("missing items", () => {
  it("asks about crockery, staff, counters and water when a caterer doesn't mention them", () => {
    const q = caterer({
      lines: [{ description: "Veg buffet per plate", quantity: 300, unit: "plate", rate: 650, amountINR: 1_95_000 }],
      subtotalINR: 1_95_000,
      totalINR: 1_95_000,
    });
    const f = checkQuote(q, ctx).findings.find((x) => x.code === "MISSING_ITEMS")!;
    expect(f.message).toContain("crockery and cutlery");
    expect(f.message).toContain("serving staff");
    expect(f.message).toContain("drinking water");
    expect(f.message).toContain("counters and buffet setup");
  });

  it("counts items mentioned in the terms, not just the lines", () => {
    const q = caterer({
      lines: [{ description: "Veg buffet per plate", quantity: 300, unit: "plate", rate: 650, amountINR: 1_95_000 }],
      subtotalINR: 1_95_000,
      totalINR: 1_95_000,
      notes: ["Rate includes crockery, waiters, buffet counters and RO water"],
    });
    expect(codes(q)).not.toContain("MISSING_ITEMS");
  });

  it("treats 'to be arranged by party' as excluded, not covered", () => {
    const q = caterer({
      lines: [
        { description: "Veg buffet per plate", quantity: 300, unit: "plate", rate: 650, amountINR: 1_95_000 },
        { description: "Crockery and service staff", amountINR: 10_000 },
        { description: "Buffet counters setup", amountINR: 5_000 },
      ],
      subtotalINR: 2_10_000,
      totalINR: 2_10_000,
      notes: ["Electricity and water to be arranged by party."],
    });
    const r = checkQuote(q, ctx);
    const ex = r.findings.find((f) => f.code === "EXCLUDED_ITEMS")!;
    expect(ex.message).toContain("drinking water");
    expect(ex.question).toContain("to be arranged by us");
    expect(r.findings.map((f) => f.code)).not.toContain("MISSING_ITEMS");
  });

  it("an item both included somewhere and excluded elsewhere counts as included", () => {
    const q = caterer({ notes: ["Extra water bottles chargeable"] }); // the lines already include mineral water
    expect(codes(q)).not.toContain("EXCLUDED_ITEMS");
  });

  it("has nothing to say for categories without a checklist", () => {
    expect(codes({ ...caterer(), category: "cake" })).not.toContain("MISSING_ITEMS");
  });
});

describe("payment terms", () => {
  it("warns about an advance over 50%, by percent or by amount", () => {
    expect(codes(caterer({ advance: { percent: 70 } }))).toContain("HIGH_ADVANCE");
    expect(codes(caterer({ advance: { amountINR: 1_50_000 } }))).toContain("HIGH_ADVANCE");
    expect(codes(caterer({ advance: { percent: 30 } }))).not.toContain("HIGH_ADVANCE");
  });

  it("asks for a refund policy when none is mentioned", () => {
    expect(codes(caterer({ refundMentioned: false }))).toContain("NO_REFUND_TERMS");
  });
});

describe("vendor message", () => {
  it("numbers every question and greets the vendor by name", () => {
    const r = checkQuote(caterer({ gst: { status: "not-mentioned" }, refundMentioned: false }), ctx);
    const msg = vendorMessage(r.questions, "Sample Caterers");
    expect(msg.startsWith("Namaste Sample Caterers ji,")).toBe(true);
    expect(msg).toContain("1. Is GST included");
    expect(msg).toContain("2. Could you share your cancellation");
  });
  it("is empty when there's nothing to ask", () => {
    expect(vendorMessage([])).toBe("");
  });
});

describe("QuoteSchema", () => {
  it("accepts a normal quote", () => {
    expect(QuoteSchema.safeParse(caterer()).success).toBe(true);
  });
  it("rejects nonsense", () => {
    for (const bad of [
      { ...caterer(), lines: [] },
      { ...caterer(), category: "<b>" },
      { ...caterer(), lines: [{ description: "x", amountINR: -5 }] },
      { ...caterer(), lines: [{ description: "x", amountINR: 1.5 }] },
      { ...caterer(), gst: { status: "maybe" } },
      { ...caterer(), extra: true },
      { ...caterer(), lines: Array(61).fill({ description: "x" }) },
    ]) {
      expect(QuoteSchema.safeParse(bad).success).toBe(false);
    }
  });
});
