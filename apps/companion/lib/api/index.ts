import { assetsApi } from "./assets";
import { assetMutationsApi } from "./asset-mutations";
import { custodyApi } from "./custody";
import { bookingsApi } from "./bookings";
import { auditsApi } from "./audits";
import { dashboardApi } from "./dashboard";
import { kitsApi } from "./kits";

export { onAuthError } from "./client";
export { invalidateResponseCache } from "./cache";

// ── API Functions ──────────────────────────────────────

export const api = {
  ...dashboardApi,
  ...assetsApi,
  ...assetMutationsApi,
  ...custodyApi,
  ...bookingsApi,
  ...auditsApi,
  ...kitsApi,
};
