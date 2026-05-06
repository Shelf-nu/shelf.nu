import { apiFetch } from "./client";
import type { MeResponse, DashboardResponse } from "./types";

export const dashboardApi = {
  /** Get current user profile and organizations */
  me: () => apiFetch<MeResponse>("/api/mobile/me"),

  /** Get dashboard data (KPIs, bookings, newest assets) */
  dashboard: (orgId: string) =>
    apiFetch<DashboardResponse>(`/api/mobile/dashboard?orgId=${orgId}`),
};
