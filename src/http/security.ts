import type { Express, NextFunction, Request, Response } from "express";
import helmet from "helmet";

const OVERRIDE_HEADERS = ["x-http-method-override", "x-http-method", "x-method-override", "x-original-url", "x-rewrite-url"];

/** Must run first: stops clients from disguising one HTTP method or path as another. */
export function stripOverrideHeaders(req: Request, _res: Response, next: NextFunction) {
  for (const h of OVERRIDE_HEADERS) delete req.headers[h];
  next();
}

/** Only the features Toran uses: the microphone (voice answers) and location ("near me"), from this site only. */
const PERMISSIONS_POLICY = "camera=(), microphone=(self), geolocation=(self), payment=(), usb=(), interest-cohort=()";
const TWO_YEARS_S = 63_072_000;

/**
 * Security headers: a strict Content Security Policy (this origin only, no inline scripts, no plugins,
 * no framing), HSTS, no referrer, and a minimal Permissions-Policy. No CORS headers are ever sent,
 * so browsers only allow same-origin calls.
 */
export function applySecurityHeaders(app: Express) {
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          fontSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
        },
      },
      // Keep the page (and the plan in the link) to ourselves when a link is followed.
      referrerPolicy: { policy: "no-referrer" },
      strictTransportSecurity: { maxAge: TWO_YEARS_S, includeSubDomains: true, preload: true },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    next();
  });
}

/** Minimal access log: method, path, status, time. Never bodies, names, phones or locations. */
export function accessLog(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on("finish", () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`));
  next();
}
