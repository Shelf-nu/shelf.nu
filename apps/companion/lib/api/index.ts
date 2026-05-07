import { assetsApi } from "./assets";
import { assetMutationsApi } from "./asset-mutations";
import { custodyApi } from "./custody";
import { bookingsApi } from "./bookings";
import { auditsApi } from "./audits";
import { dashboardApi } from "./dashboard";

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
};
