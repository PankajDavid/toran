import type { NextFunction, Request, Response } from "express";
import { PlanInputError } from "../engine/index.js";

/** Replies 400 with the field-level issues for bad plan input; anything else goes to the error handler. */
export function handlePlanInputError(err: unknown, res: Response) {
  if (!(err instanceof PlanInputError)) throw err;
  res.status(400).json({ error: "Please check your inputs.", issues: err.issues });
}

/** Logs an upstream failure by kind and status only (never request content). */
export function logUpstream(what: string, err: unknown) {
  const e = err as { kind?: string; detail?: string };
  console.warn(`${what} failed (${e.kind ?? "error"}${e.detail ? ` ${e.detail}` : ""})`);
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}

/** Generic message to the client; details stay in server logs. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const status = (err as { status?: number })?.status;
  if (status === 400 || status === 413) {
    res.status(status).json({ error: status === 413 ? "Request too large." : "Malformed request." });
    return;
  }
  console.error("Unhandled error:", err instanceof Error ? err.message : "unknown");
  res.status(500).json({ error: "Something went wrong. Please try again." });
}
