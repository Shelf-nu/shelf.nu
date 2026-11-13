import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import { api, onForbidden, type Organization } from "./api";
import { setSentryUser } from "./sentry";
import { createReadTracker } from "./read-tracker";
import { createRecheckThrottle } from "./recheck-throttle";
import { pickLandingOrg, refreshOpenOrg } from "./workspace-access";

/**
 * Where an EXPLICIT workspace choice made on this device is persisted.
 *
 * Only the user's own switches are written here — automatic landings never
 * are, so an empty key means "this device has no opinion" and the server's
 * landing order decides. (The retired un-suffixed key was written by automatic
 * landings too, which made it meaningless as a signal of choice; it is left
 * behind unread.)
 */
const SELECTED_ORG_KEY = "shelf_selected_org_id_v2";

/**
 * Shortest gap between two `/me` re-reads set off by refused requests. A
 * screen that loads several things at once can collect several 403s; one
 * re-read (plus at most one at the end of the gap) answers them all.
 */
const FORBIDDEN_RECHECK_GAP_MS = 15_000;

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
  /**
   * Switches to a workspace for this visit only, without recording it as the
   * person's choice, so the next launch lands where it otherwise would. For
   * switches the app makes on the person's behalf, such as opening a tapped
   * push.
   */
  visitOrg: (org: Organization) => void;
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
  /**
   * Re-reads `/me`. Resolves `false` when the read failed, `true` otherwise.
   * `silent` leaves the loading and error state alone.
   */
  refresh: (options?: { silent?: boolean }) => Promise<boolean>;
};

const OrgContext = createContext<OrgState | undefined>(undefined);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * The live selection, readable from async continuations. `fetchOrgs` is
   * memoized on `[user]`, so its closure's `currentOrg` can be stale by the
   * time a fetch resolves; a landing decision taken then must see the
   * workspace the user has ACTUALLY selected meanwhile, not the one from
   * when the fetch started.
   */
  const currentOrgRef = useRef<Organization | null>(null);

  /** The user chose this workspace — apply it and remember the choice. */
  const handleSetCurrentOrg = useCallback((org: Organization) => {
    currentOrgRef.current = org;
    setCurrentOrg(org);
    AsyncStorage.setItem(SELECTED_ORG_KEY, org.id).catch(() => {});
  }, []);

  /** The app landed here on its own — apply it without recording a choice. */
  const applyLandingOrg = useCallback((org: Organization) => {
    currentOrgRef.current = org;
    setCurrentOrg(org);
  }, []);

  /**
   * Overlapping `/me` reads: only the latest applies its answer, so a slow
   * older read (a background re-check, say) cannot put back a workspace state
   * that a newer one (a tap on "Check again") already replaced; and loading
   * ends only when the read that carries the data ends.
   */
  const readsRef = useRef<ReturnType<typeof createReadTracker> | null>(null);
  readsRef.current ??= createReadTracker(setIsLoading);

  /**
   * Reads `/me` and applies it. A `silent` read (the re-check after a refused
   * request) leaves the loading and error state alone, so no screen flashes a
   * spinner or an error for a check the person did not ask for.
   *
   * @returns `false` when the read failed, so a caller that asked for it can
   *   say so; `true` when it applied, or a newer read took over.
   */
  const fetchOrgs = useCallback(
    async (options?: { silent?: boolean }): Promise<boolean> => {
      const silent = options?.silent === true;
      const reads = readsRef.current!;
      const readId = reads.begin(!silent);
      try {
        if (!user) {
          setOrganizations([]);
          currentOrgRef.current = null;
          setCurrentOrg(null);
          setUserProfile(null);
          setIsLoading(false);
          setError(null);
          return true;
        }

        if (!silent) setError(null);

        const { data, error: fetchError } = await api.me();

        if (!reads.isLatest(readId)) return true;

        if (fetchError || !data) {
          if (!silent) {
            setError(fetchError || "Failed to load workspace data");
          }
          return false;
        }

        // A good answer clears an error left by an earlier failed read, a
        // quiet one included, so no screen keeps showing it over fresh data.
        setError(null);

        // Store user profile
        setUserProfile(data.user);

        const orgs = data.organizations;
        setOrganizations(orgs);

        // Landing hierarchy: an explicit choice made on THIS device wins, then
        // the server's cross-device choice, then the server's landing order
        // (which already leads with its own best pick). An inactive workspace
        // is passed over while an active one exists (see `pickLandingOrg`).
        let savedOrgId: string | null = null;
        try {
          savedOrgId = await AsyncStorage.getItem(SELECTED_ORG_KEY);
        } catch {}
        if (!reads.isLatest(readId)) return true;

        const landOnPreferredOrg = () => {
          const landing = pickLandingOrg(orgs, [
            savedOrgId,
            data.lastSelectedOrganizationId,
          ]);
          if (landing) applyLandingOrg(landing);
        };

        // Keep the LIVE selection while it is still listed. Read through the
        // ref, so a workspace picked while this fetch was in flight is never
        // stomped by a landing decision based on pre-fetch state. It stays
        // open even when it became inactive, so the person sees why instead
        // of being moved.
        const liveOrg = currentOrgRef.current;
        if (liveOrg) {
          const kept = refreshOpenOrg(liveOrg, orgs);
          if (!kept) landOnPreferredOrg();
          else if (kept !== liveOrg) applyLandingOrg(kept);
        } else {
          landOnPreferredOrg();
        }
        return true;
      } finally {
        reads.end(readId);
      }
    },
    [user]
  );

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  // A refused request may mean the open workspace became inactive while the
  // app was open: re-read `/me` quietly, so the inactive screen replaces the
  // screen's own error. The throttle runs at most once per gap and keeps one
  // trailing re-read, so a refusal inside the gap is never lost.
  useEffect(() => {
    const recheck = createRecheckThrottle({
      gapMs: FORBIDDEN_RECHECK_GAP_MS,
      run: () => void fetchOrgs({ silent: true }),
    });
    const unsubscribe = onForbidden(recheck.request);
    return () => {
      unsubscribe();
      recheck.cancel();
    };
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
      visitOrg: applyLandingOrg,
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
      applyLandingOrg,
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
