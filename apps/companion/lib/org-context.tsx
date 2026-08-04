import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  resolveFormatPrefs,
  type ResolvedFormatPrefs,
  type DateFormatPreference,
  type TimeFormatPreference,
  type WeekStartPreference,
} from "@shelf/datetime";
import { useAuth } from "./auth-context";
import { api, type Organization } from "./api";
import { setSentryUser } from "./sentry";

const SELECTED_ORG_KEY = "shelf_selected_org_id";

/** User profile data returned by the /me endpoint */
export type UserProfile = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePicture: string | null;
  /**
   * Raw date/time format preferences from `/api/mobile/me` (nullable, and
   * absent on pre-format-prefs servers). Resolved into concrete `formatPrefs`
   * below with a device-hint fallback; consumed via `useDateFormatter`.
   */
  dateFormat?: DateFormatPreference | null;
  timeFormat?: TimeFormatPreference | null;
  weekStart?: WeekStartPreference | null;
  timeZone?: string | null;
};

type OrgState = {
  organizations: Organization[];
  currentOrg: Organization | null;
  setCurrentOrg: (org: Organization) => void;
  userProfile: UserProfile | null;
  /**
   * The acting user's format preferences, resolved to concrete values (every
   * field non-null) with a device-hint fallback. Always present — defaults to
   * device-local formatting until the profile loads. Read via `useFormatPrefs`
   * / `useDateFormatter` (`lib/use-date-formatter.ts`).
   */
  formatPrefs: ResolvedFormatPrefs;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const OrgContext = createContext<OrgState | undefined>(undefined);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Persist selected org when it changes
  const handleSetCurrentOrg = useCallback((org: Organization) => {
    setCurrentOrg(org);
    AsyncStorage.setItem(SELECTED_ORG_KEY, org.id).catch(() => {});
  }, []);

  const fetchOrgs = useCallback(async () => {
    if (!user) {
      setOrganizations([]);
      setCurrentOrg(null);
      setUserProfile(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await api.me();

    if (fetchError || !data) {
      setError(fetchError || "Failed to load workspace data");
      setIsLoading(false);
      return;
    }

    // Store user profile
    setUserProfile(data.user);

    const orgs = data.organizations;
    setOrganizations(orgs);

    // Try to restore previously selected org from storage
    let savedOrgId: string | null = null;
    try {
      savedOrgId = await AsyncStorage.getItem(SELECTED_ORG_KEY);
    } catch {}

    // Preserve current selection if still valid
    if (currentOrg) {
      const stillExists = orgs.find((o) => o.id === currentOrg.id);
      if (!stillExists && orgs.length > 0) {
        const restoredOrg = savedOrgId
          ? orgs.find((o) => o.id === savedOrgId)
          : null;
        handleSetCurrentOrg(restoredOrg || orgs[0]);
      }
    } else if (orgs.length > 0) {
      // First load — try restoring from storage, otherwise pick first
      const restoredOrg = savedOrgId
        ? orgs.find((o) => o.id === savedOrgId)
        : null;
      handleSetCurrentOrg(restoredOrg || orgs[0]);
    }

    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  // Keep Sentry's user/org/role scope in sync so every event (crashes included)
  // is self-describing — which org, what role, which user — for triage without
  // re-investigation. No-ops in dev / without a DSN. IDs & roles only, no PII.
  useEffect(() => {
    setSentryUser({
      userId: userProfile?.id ?? null,
      orgId: currentOrg?.id ?? null,
      role: currentOrg?.roles?.join(",") ?? null,
    });
  }, [userProfile?.id, currentOrg?.id, currentOrg?.roles]);

  // Resolve the acting user's raw prefs into concrete format prefs ONCE per
  // profile change. `Intl.DateTimeFormat().resolvedOptions()` supplies the
  // device locale + IANA zone (Hermes ships Intl, verified on-device); every
  // unset pref field falls back to that device hint. Passing `null` while the
  // profile loads (or against a pre-format-prefs server) yields fully
  // device-local formatting rather than an arbitrary US/UTC default.
  const formatPrefs = useMemo<ResolvedFormatPrefs>(() => {
    // Capture device hints defensively. Hermes ships Intl, but guard anyway:
    // where Intl timezone data is missing/partial, resolvedOptions() can yield an
    // undefined/blank timeZone (or, in the extreme, throw). resolveFormatPrefs
    // validates the zone downstream, but coalescing here keeps an undefined from
    // ever flowing in as a hint, and a broken Intl from throwing out of render.
    let locale = "en-US";
    let timeZone = "UTC";
    try {
      const resolved = Intl.DateTimeFormat().resolvedOptions();
      locale = resolved.locale || locale;
      timeZone = resolved.timeZone || timeZone;
    } catch {
      // Keep the en-US / UTC fallbacks.
    }
    const raw = userProfile
      ? {
          dateFormat: userProfile.dateFormat ?? null,
          timeFormat: userProfile.timeFormat ?? null,
          weekStart: userProfile.weekStart ?? null,
          timeZone: userProfile.timeZone ?? null,
        }
      : null;
    return resolveFormatPrefs(raw, { locale, timeZone });
  }, [userProfile]);

  const value = useMemo(
    () => ({
      organizations,
      currentOrg,
      setCurrentOrg: handleSetCurrentOrg,
      userProfile,
      formatPrefs,
      isLoading,
      error,
      refresh: fetchOrgs,
    }),
    [
      organizations,
      currentOrg,
      handleSetCurrentOrg,
      userProfile,
      formatPrefs,
      isLoading,
      error,
      fetchOrgs,
    ]
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error("useOrg must be used within OrgProvider");
  }
  return context;
}

export type { Organization };
