import { AiError, type AiClient, type AiJsonRequest } from "./client.js";

/** Test double: returns scripted responses in order and records every request. */
export function fakeAiClient(responses: (unknown | AiError)[]): AiClient & { calls: AiJsonRequest[] } {
  const queue = [...responses];
  const calls: AiJsonRequest[] = [];
  return {
    available: true,
    calls,
    async generateJson(req) {
      calls.push(req);
      if (queue.length === 0) throw new AiError("upstream", "No scripted response left");
      const next = queue.shift();
      if (next instanceof AiError) throw next;
      return next;
    },
  };
}
