import { GoogleGenAI, ThinkingLevel } from "@google/genai";

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
  /** How long the model may "think" before answering. Lower = faster. */
  thinking?: "minimal" | "low";
  timeoutMs?: number;
}

export interface WebSource {
  url: string;
  title: string;
}

export interface GroundedResult {
  /** Parsed JSON (unknown shape — callers MUST validate). */
  json: unknown;
  /** Pages Google Search returned for this answer. Empty = nothing to cite. */
  sources: WebSource[];
  /** The searches Google ran, shown as "search on Google" links. */
  searchQueries: string[];
}

export interface AiClient {
  readonly available: boolean;
  /** Returns parsed JSON (unknown shape — callers MUST validate). Throws AiError on any failure. */
  generateJson(req: AiJsonRequest): Promise<unknown>;
  /** Same, but the model may use Google Search; returns the pages it used. Optional: fakes may omit it. */
  generateGrounded?(req: AiJsonRequest): Promise<GroundedResult>;
}

export class AiError extends Error {
  constructor(
    public readonly kind: "unavailable" | "timeout" | "bad-output" | "upstream",
    message: string,
    /** Server-log-only diagnostic (e.g. HTTP status). Never sent to clients. */
    public readonly detail?: string,
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

  /** Pulls JSON out of a reply that may wrap it in ``` fences or prose. */
  const parseLoose = (text: string): unknown => {
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) throw new AiError("bad-output", "No JSON in AI response");
    try { return JSON.parse(m[0]); } catch { throw new AiError("bad-output", "AI response was not valid JSON"); }
  };
  const upstream = (err: unknown) => {
    const e = err as { status?: number; message?: string };
    const statusWord = /\b(NOT_FOUND|PERMISSION_DENIED|UNAUTHENTICATED|INVALID_ARGUMENT|RESOURCE_EXHAUSTED|FAILED_PRECONDITION|UNAVAILABLE)\b/.exec(e?.message ?? "")?.[1];
    return new AiError("upstream", "AI request failed", [e?.status, statusWord].filter(Boolean).join(" ") || undefined);
  };

  return {
    available: true,
    async generateGrounded(req) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 30_000);
      const call = (withSchema: boolean) =>
        genai.models.generateContent({
          model: models[req.tier ?? "smart"],
          contents: [{ role: "user", parts: req.parts }],
          config: {
            systemInstruction: req.system,
            tools: [{ googleSearch: {} }],
            // Gemini 3 can combine search with a JSON schema; if a model refuses, retry asking for JSON in text.
            ...(withSchema ? { responseMimeType: "application/json", responseJsonSchema: req.schema } : {}),
            thinkingConfig: { thinkingLevel: req.thinking === "minimal" ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW },
            abortSignal: controller.signal,
          },
        });
      try {
        let res;
        try {
          res = await call(true);
        } catch (err) {
          if (controller.signal.aborted || !/INVALID_ARGUMENT/.test((err as Error)?.message ?? "")) throw err;
          res = await call(false);
        }
        const text = res.text;
        if (!text) throw new AiError("bad-output", "Empty AI response");
        const meta = res.candidates?.[0]?.groundingMetadata;
        const sources: WebSource[] = [];
        for (const c of meta?.groundingChunks ?? []) {
          const uri = c.web?.uri;
          if (!uri || sources.some((x) => x.url === uri)) continue;
          sources.push({ url: uri, title: c.web?.title || "web page" });
        }
        return { json: parseLoose(text), sources, searchQueries: (meta?.webSearchQueries ?? []).slice(0, 4) };
      } catch (err) {
        if (err instanceof AiError) throw err;
        if (controller.signal.aborted) throw new AiError("timeout", "AI request timed out");
        throw upstream(err);
      } finally {
        clearTimeout(timer);
      }
    },
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
            ...(req.thinking
              ? { thinkingConfig: { thinkingLevel: req.thinking === "minimal" ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW } }
              : {}),
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
        // Keep only the HTTP status and Google's status word for server-side diagnosis.
        throw upstream(err);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * One tiny request per model at startup, so every deploy logs whether the AI
 * really works (key valid, model names right). Logs only the outcome — no keys,
 * no user data.
 */
export async function aiSelfCheck(ai: AiClient, log: (line: string) => void = console.log): Promise<void> {
  if (!ai.available) {
    log("AI self-check: offline (no GEMINI_API_KEY) — fallbacks in use");
    return;
  }
  for (const tier of ["fast", "smart"] as const) {
    try {
      const r = (await ai.generateJson({
        tier,
        thinking: tier === "fast" ? "minimal" : "low", // same settings the app uses
        timeoutMs: 20_000,
        system: 'Reply with the JSON object {"ok": true}.',
        parts: [{ text: "ping" }],
        schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      })) as { ok?: unknown };
      log(`AI self-check (${tier}): ${r?.ok === true ? "ok" : "unexpected reply"}`);
    } catch (err) {
      const e = err as AiError;
      log(`AI self-check (${tier}): FAILED — ${e.kind ?? "error"}${e.detail ? ` (${e.detail})` : ""}`);
    }
  }
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
