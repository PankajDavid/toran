import { createApp } from "./app.js";
import { aiClientFromEnv, aiSelfCheck } from "./ai/client.js";

const port = Number(process.env.PORT) || 8080;
const ai = aiClientFromEnv();

createApp({ ai }).listen(port, () => {
  console.log(`Toran listening on port ${port}`);
  console.log(
    `AI models: smart=${process.env.GEMINI_MODEL || "gemini-3.8-flash"}, fast=${process.env.GEMINI_FAST_MODEL || "gemini-3.5-flash-lite"}`,
  );
  void aiSelfCheck(ai);
});
