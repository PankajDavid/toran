import type { EventType } from "../engine/config.js";
import type { Known, KnownField } from "./known.js";

/**
 * The interview script. Code — not the AI — decides what to ask next, so the
 * conversation is predictable, testable and costs no AI call to drive.
 */

export interface QuestionOption {
  label: string;
  /** Fields this button sets when tapped. */
  set: Known;
}

export interface Question {
  field: KnownField;
  text: string;
  options: QuestionOption[];
  /** "multi" = several options can be ticked (wedding functions). */
  mode: "single" | "multi";
  /** What free input fits: a date picker, a number, or text. */
  input: "date" | "number" | "text" | "none";
  placeholder?: string;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const lakh = (n: number) => n * 100_000;
const fmtINR = (n: number) => (n >= 1e7 ? `₹${n / 1e7} crore` : n >= 1e5 ? `₹${n / 1e5} lakh` : `₹${n.toLocaleString("en-IN")}`);

const GUEST_PRESETS: Record<EventType, number[]> = {
  wedding: [150, 300, 500, 800],
  birthday: [20, 50, 100, 200],
  party: [10, 20, 40, 80],
  community: [100, 300, 800, 2000],
};

const BUDGET_PRESETS: Record<EventType, number[]> = {
  wedding: [lakh(5), lakh(10), lakh(20), lakh(40)],
  birthday: [25_000, 50_000, lakh(1), lakh(3)],
  party: [10_000, 25_000, 50_000, lakh(1)],
  community: [50_000, lakh(1), lakh(3), lakh(10)],
};

const SUB_TYPE_QUESTIONS: Record<EventType, { text: string; options: [string, string][] }> = {
  wedding: {
    text: "Which style of wedding?",
    options: [
      ["Punjabi", "punjabi"],
      ["South Indian", "south-indian"],
      ["Bengali", "bengali"],
      ["Christian", "christian"],
      ["Other", "other"],
    ],
  },
  birthday: {
    text: "Whose birthday is it?",
    options: [
      ["A child's", "kid"],
      ["An adult's", "adult"],
      ["A milestone (25th, 50th, 60th…)", "milestone"],
    ],
  },
  party: {
    text: "What kind of get-together?",
    options: [
      ["Kitty party", "kitty"],
      ["Anniversary", "anniversary"],
      ["Something else", "other"],
    ],
  },
  community: {
    text: "What kind of community event?",
    options: [
      ["Jagran", "jagran"],
      ["Langar", "langar"],
      ["Diwali mela", "diwali-mela"],
      ["Society / RWA function", "rwa-function"],
      ["Something else", "other"],
    ],
  },
};

export const FIRST_QUESTION: Question = {
  field: "eventType",
  text: "Namaste! What are we planning?",
  mode: "single",
  input: "text",
  placeholder: 'Or tell me in your own words, e.g. "Beti ki shaadi, Feb mein, 300 log, 15 lakh"',
  options: [
    { label: "Wedding", set: { eventType: "wedding" } },
    { label: "Birthday", set: { eventType: "birthday" } },
    { label: "Kitty party", set: { eventType: "party", subType: "kitty" } },
    { label: "Anniversary", set: { eventType: "party", subType: "anniversary" } },
    { label: "Jagran", set: { eventType: "community", subType: "jagran" } },
    { label: "Langar", set: { eventType: "community", subType: "langar" } },
    { label: "Diwali mela", set: { eventType: "community", subType: "diwali-mela" } },
    { label: "Society function", set: { eventType: "community", subType: "rwa-function" } },
    { label: "Something else", set: { eventType: "party", subType: "other" } },
  ],
};

/** The next missing detail, or null when the plan can be built. */
export function nextQuestion(k: Known): Question | null {
  if (!k.eventType) return FIRST_QUESTION;
  const type = k.eventType;

  if (!k.subType) {
    const q = SUB_TYPE_QUESTIONS[type];
    return {
      field: "subType",
      text: q.text,
      mode: "single",
      input: "none",
      options: q.options.map(([label, value]) => ({ label, set: { subType: value } })),
    };
  }

  if (type === "wedding" && !k.subEvents?.length) {
    return {
      field: "subEvents",
      text: "Which functions are you planning? Tick all that apply.",
      mode: "multi",
      input: "none",
      options: [
        ["Haldi", "haldi"],
        ["Mehendi", "mehendi"],
        ["Sangeet", "sangeet"],
        ["Ceremony", "ceremony"],
        ["Reception", "reception"],
      ].map(([label, value]) => ({ label, set: { subEvents: [value] } })),
    };
  }

  if (!k.eventDate) {
    return {
      field: "eventDate",
      text: k.eventMonth ? `Which date in ${MONTH_NAMES[k.eventMonth - 1]}?` : "When is the event?",
      mode: "single",
      input: "date",
      options: [],
      placeholder: k.eventMonth ? `e.g. 14 ${MONTH_NAMES[k.eventMonth - 1].slice(0, 3)}` : "e.g. 14 Feb",
    };
  }

  if (!k.guestCount) {
    return {
      field: "guestCount",
      text: "About how many guests?",
      mode: "single",
      input: "number",
      placeholder: "Number of guests",
      options: GUEST_PRESETS[type].map((n) => ({ label: `About ${n.toLocaleString("en-IN")}`, set: { guestCount: n } })),
    };
  }

  if (!k.totalBudgetINR) {
    return {
      field: "totalBudgetINR",
      text: "What's the total budget?",
      mode: "single",
      input: "text",
      placeholder: "e.g. 15 lakh or 2,50,000",
      options: BUDGET_PRESETS[type].map((n) => ({ label: fmtINR(n), set: { totalBudgetINR: n } })),
    };
  }

  if (!k.city) {
    return {
      field: "city",
      text: "Which city or town is it in?",
      mode: "single",
      input: "text",
      placeholder: "e.g. Ludhiana",
      options: [],
    };
  }

  if (!k.cityTier) {
    return {
      field: "cityTier",
      text: `How big is ${k.city}? This sets realistic food costs.`,
      mode: "single",
      input: "none",
      options: [
        { label: "Metro", set: { cityTier: 1 } },
        { label: "Large city", set: { cityTier: 2 } },
        { label: "Smaller town", set: { cityTier: 3 } },
      ],
    };
  }

  if (!k.diet) {
    // Langar and jagran food is vegetarian by tradition, so only offer what fits.
    const religiousVeg = type === "community" && (k.subType === "langar" || k.subType === "jagran");
    return {
      field: "diet",
      text: "What food will you serve? This shapes the menu ideas.",
      mode: "single",
      input: "none",
      options: religiousVeg
        ? [
            { label: "Pure veg", set: { diet: "veg" } },
            { label: "Jain (no onion, garlic)", set: { diet: "jain" } },
          ]
        : [
            { label: "Pure veg", set: { diet: "veg" } },
            { label: "Jain (no onion, garlic)", set: { diet: "jain" } },
            { label: "Non-veg", set: { diet: "non-veg" } },
            { label: "Both veg and non-veg", set: { diet: "mixed" } },
          ],
    };
  }

  return null;
}

/** Turns a complete Known into the planner's input. Returns null if anything required is missing. */
export function toPlanInput(k: Known): Record<string, unknown> | null {
  if (nextQuestion(k) !== null) return null;
  const { eventMonth: _month, ...rest } = k;
  return rest as Record<string, unknown>;
}
