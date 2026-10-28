/* ---------- formatting ---------- */
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
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
export const inr = (n) => `₹${Number(n).toLocaleString("en-IN")}`;
export const fmtDate = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const pct = (bp) => `${(bp / 100).toFixed(bp % 100 ? 1 : 0)}%`;

export const LABELS = {
  eventType: { wedding: "Wedding", birthday: "Birthday", party: "Get-together", community: "Community event" },
  subType: {
    punjabi: "Punjabi",
    "south-indian": "South Indian",
    bengali: "Bengali",
    christian: "Christian",
    other: "Other style",
    kid: "Child's birthday",
    adult: "Adult's birthday",
    milestone: "Milestone birthday",
    kitty: "Kitty party",
    anniversary: "Anniversary",
    jagran: "Jagran",
    langar: "Langar",
    "diwali-mela": "Diwali mela",
    "rwa-function": "Society function",
  },
  cityTier: { 1: "Metro", 2: "Large city", 3: "Smaller town" },
  diet: { veg: "Vegetarian", jain: "Jain", "non-veg": "Non-veg", mixed: "Veg + non-veg" },
};
export const subTypeLabel = (k) =>
  k.eventType === "community" && k.subType === "other"
    ? "Community event"
    : k.eventType === "party" && k.subType === "other"
      ? "Get-together"
      : LABELS.subType[k.subType] || k.subType;

export function describeField(field, k) {
  switch (field) {
    case "eventType":
      return LABELS.eventType[k.eventType];
    case "subType":
      return subTypeLabel(k);
    case "subEvents":
      return k.subEvents.map((s) => s[0].toUpperCase() + s.slice(1)).join(", ");
    case "eventDate":
      return fmtDate(k.eventDate);
    case "eventMonth":
      return `In ${MONTHS_LONG[k.eventMonth - 1]}`;
    case "guestCount":
      return `About ${k.guestCount.toLocaleString("en-IN")} guests`;
    case "totalBudgetINR":
      return inr(k.totalBudgetINR);
    case "city":
      return k.city;
    case "cityTier":
      return LABELS.cityTier[k.cityTier];
    case "diet":
      return LABELS.diet[k.diet];
    default:
      return "";
  }
}
export const FIELD_ORDER = [
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
];
