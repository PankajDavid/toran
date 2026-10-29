import { createApp } from "./app.js";
import { aiClientFromEnv, aiSelfCheck, DEFAULT_MODELS } from "./ai/client.js";
import { placesClientFromEnv } from "./places/places.js";

const port = Number(process.env.PORT) || 8080;
const ai = aiClientFromEnv();
const places = placesClientFromEnv();

createApp({ ai, places }).listen(port, () => {
  console.log(`Toran listening on port ${port}`);
  console.log(`Vendor search: ${places.available ? "configured" : "offline (no GOOGLE_MAPS_API_KEY)"}`);
  console.log(
    `AI models: smart=${process.env.GEMINI_MODEL || DEFAULT_MODELS.smart}, fast=${process.env.GEMINI_FAST_MODEL || DEFAULT_MODELS.fast}`,
  );
  void aiSelfCheck(ai);
});
