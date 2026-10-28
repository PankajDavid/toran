import { createApp } from "./src/app.js";
import type { AiClient } from "./src/ai/client.js";
const reply = { readable: true, vendorName: "Shubh Rasoi Caterers", lines: [
  { description: "Veg Buffet Dinner (per plate)", quantity: 250, unit: "plate", rate: 650, amountINR: 172500 },
  { description: "Live Chaat Counter", quantity: 1, rate: 15000, amountINR: 15000 },
  { description: "Paneer Tikka Starter (per plate)", quantity: 250, unit: "plate", rate: 90, amountINR: 22500 } ],
  subtotalINR: 210000, gstStatus: "extra", minimumGuarantee: 350, advancePercent: 60, refundMentioned: false,
  notes: ["Minimum guarantee 350 plates.", "60% advance at the time of booking, balance before the function.", "Rates valid till 31/01/2027.", "Electricity and water to be arranged by party."] };
const ai: AiClient = { available: true, async generateJson(req) { if (JSON.stringify(req.schema).includes("readable")) return reply; throw new Error("x"); } };
createApp({ ai }).listen(8101);
