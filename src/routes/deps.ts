import type { AiClient } from "../ai/client.js";
import type { RateLimits } from "../http/limits.js";
import type { PlacesClient } from "../places/places.js";

/** What every route group needs. Injected, so tests can fake AI, Places and the date. */
export interface RouteDeps {
  ai: AiClient;
  places: PlacesClient;
  /** Today's date in India (YYYY-MM-DD). */
  today: () => string;
  limits: RateLimits;
}
