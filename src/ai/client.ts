import { GoogleGenAI } from "@google/genai";

/**
 * The one door to the AI. Everything else talks to this interface, so tests
 * can swap in a fake and the app keeps working (with fallbacks) without a key.
 */

export interface AiPart {
  text?: string;
  /** Base64 file data, e.g. a quote photo or PDF. */
  inlineData?: { mimeType: string; data: string };
}

export interface AiJsonRequest {
  /** Fixed instructions written by us. Never contains user text. */
  system: string;
  /** User-supplied material, already wrapped as delimited data. */
  parts: AiPart[];
  /** JSON Schema the model must follow. Output is still re-validated with zod. */
  schema: Record<string, unknown>;
  /** "fast" for parsing small answers, "smart" for reading documents and ideas. */
  tier?: "fast" | "smart";
  timeoutMs?: number;
}

export interface AiClient {
  readonly available: boolean;
  /** Returns parsed JSON (unknown shape — callers MUST validate). Throws AiError on any failure. */
  generateJson(req: AiJsonRequest): Promise<unknown>;
}

export class AiError extends Error {
  constructor(
    public readonly kind: "unavailable" | "timeout" | "bad-output" | "upstream",
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** Used when no API key is configured: every call fails fast, callers fall back. */
export const offlineClient: AiClient = {
  available: false,
  async generateJson() {
    throw new AiError("unavailable", "AI is not configured");
  },
};

export interface GeminiOptions {
  apiKey: string;
  smartModel?: string;
  fastModel?: string;
}

export function createGeminiClient(opts: GeminiOptions): AiClient {
  const genai = new GoogleGenAI({ apiKey: opts.apiKey });
  const models = {
    smart: opts.smartModel || "gemini-3.8-flash",
    fast: opts.fastModel || "gemini-3.5-flash-lite",
  };

  return {
    available: true,
    async generateJson(req) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 20_000);
      try {
        const res = await genai.models.generateContent({
          model: models[req.tier ?? "smart"],
          contents: [{ role: "user", parts: req.parts }],
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            responseJsonSchema: req.schema,
            abortSignal: controller.signal,
          },
        });
        const text = res.text;
        if (!text) throw new AiError("bad-output", "Empty AI response");
        try {
          return JSON.parse(text);
        } catch {
          throw new AiError("bad-output", "AI response was not valid JSON");
        }
      } catch (err) {
        if (err instanceof AiError) throw err;
        if (controller.signal.aborted) throw new AiError("timeout", "AI request timed out");
        // Never surface upstream messages to users; they can contain request details.
        throw new AiError("upstream", "AI request failed");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function aiClientFromEnv(env: NodeJS.ProcessEnv = process.env): AiClient {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return offlineClient;
  return createGeminiClient({ apiKey, smartModel: env.GEMINI_MODEL, fastModel: env.GEMINI_FAST_MODEL });
}

/**
 * Wraps untrusted text so the model treats it as data. Angle brackets are
 * neutralised so the text cannot close the wrapper and pose as instructions.
 */
export function asData(label: string, text: string): AiPart {
  const safe = text.replace(/</g, "‹").replace(/>/g, "›");
  return { text: `<${label}>\n${safe}\n</${label}>` };
}
