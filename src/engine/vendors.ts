import type { EventType } from "./config.js";
import { SEARCH_TERMS, VENDOR_TEMPLATES } from "./data/vendor-checklists.js";

/**
 * The vendor checklist for one plan: which categories apply, their questions and search terms.
 * The categories and questions themselves are in data/vendor-checklists.ts.
 * Deliberately contains NO vendor names, phone numbers or businesses:
 * the app helps users evaluate real vendors, it never invents them.
 */

export { SEARCH_TERMS };

export interface VendorChecklistItem {
  key: string;
  category: string;
  questions: string[];
  /** What to search for on Google / Google Maps (e.g. "caterers"). */
  search: string;
  /** Budget line key, when this vendor is paid from a line in this plan. */
  line?: string;
}

export function buildVendorChecklist(eventType: EventType, selectors: readonly string[] = []): VendorChecklistItem[] {
  return VENDOR_TEMPLATES[eventType]
    .filter((t) => !t.onlyFor || t.onlyFor.some((s) => selectors.includes(s)))
    .map(({ key, category, questions, line }) => ({
      key,
      category,
      questions: [...questions],
      search: SEARCH_TERMS[key] ?? category.toLowerCase(),
      ...(line ? { line } : {}),
    }));
}
