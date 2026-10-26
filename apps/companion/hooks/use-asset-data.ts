import { useState, useEffect, useCallback, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { api, type AssetDetail } from "@/lib/api";
import { announce } from "@/lib/a11y";
import { assetChangeVersion } from "@/lib/asset-refresh";

interface UseAssetDataReturn {
  asset: AssetDetail | null;
  setAsset: React.Dispatch<React.SetStateAction<AssetDetail | null>>;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  fetchAsset: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

/**
 * Owns the data fetch + lifecycle for the asset-detail screen.
 *
 * Both `assetId` and `orgId` are required by the underlying API; the hook
 * is tolerant of `orgId` being briefly `undefined` (e.g. while the
 * `OrgProvider` hydrates `currentOrg` after sign-in) by keeping
 * `isLoading: true` and deferring the fetch until the value arrives.
 * Without this guard the screen would flash a stale "Asset not found"
 * error state in the gap between first render and org-context resolution.
 *
 * @param assetId - Identifier of the asset to fetch.
 * @param orgId - Caller's current workspace id. When `undefined`, the
 *   hook waits (keeps `isLoading: true`, no fetch fired, no error set).
 *   Once it becomes defined the fetch runs automatically via the effect
 *   dependency.
 * @returns The current asset / loading / error state plus stable
 *   imperative setters for downstream callers that need to refresh or
 *   override.
 */
export function useAssetData(
  assetId: string,
  orgId: string | undefined
): UseAssetDataReturn {
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Identity of the newest asset request. Every load (mount, pull-to-refresh,
  // an action's reload, the focus refetch below) takes the next number, and
  // only the newest may write state, so an older answer that lands late
  // never replaces a newer one.
  const latestRequest = useRef(0);

  const fetchAsset = useCallback(async () => {
    if (!orgId) return;
    const request = ++latestRequest.current;
    const { data, error: fetchErr } = await api.asset(assetId, orgId);
    if (request !== latestRequest.current) return;
    // Request cancelled (navigation): ignore
    if (!data && !fetchErr) return;
    if (fetchErr || !data) {
      setError(fetchErr || "Failed to load asset details");
      setAsset(null);
    } else {
      setAsset(data.asset);
      setError(null);
    }
  }, [assetId, orgId]);

  // The asset-change version this screen's data reflects (see
  // lib/asset-refresh.ts). Read before each fetch starts, so a change saved
  // while a request is in flight still triggers the next focus refetch.
  const seenChangeVersion = useRef(assetChangeVersion(assetId));

  useEffect(() => {
    // why: when orgId is briefly undefined (org context still hydrating)
    // we deliberately do nothing — `isLoading` stays at its initial / last
    // `true` so the screen keeps showing the skeleton instead of flashing
    // an "Asset not found" error state. The effect re-runs automatically
    // when orgId resolves because `fetchAsset` closes over it.
    if (!orgId) return;
    seenChangeVersion.current = assetChangeVersion(assetId);
    setIsLoading(true);
    fetchAsset().finally(() => setIsLoading(false));
  }, [assetId, fetchAsset, orgId]);

  // Returning to the screen after another screen changed this asset (the
  // edit form) refetches it in place. Quiet on failure: the asset on screen
  // stays rather than being swapped for the error state, and the version is
  // left unseen so the next focus tries again.
  useFocusEffect(
    useCallback(() => {
      if (!orgId) return;
      const version = assetChangeVersion(assetId);
      if (version === seenChangeVersion.current) return;
      const request = ++latestRequest.current;
      void api.asset(assetId, orgId).then(({ data }) => {
        if (request !== latestRequest.current || !data) return;
        seenChangeVersion.current = version;
        setAsset(data.asset);
        setError(null);
      });
      // Leaving the screen, or a workspace switch, drops this refetch if it
      // is still the newest request; the version stays unseen for next time.
      return () => {
        if (latestRequest.current === request) latestRequest.current += 1;
      };
    }, [assetId, orgId])
  );

  const onRefresh = async () => {
    setIsRefreshing(true);
    await fetchAsset();
    setIsRefreshing(false);
    announce("Content refreshed");
  };

  return {
    asset,
    setAsset,
    isLoading,
    isRefreshing,
    error,
    setError,
    setIsLoading,
    fetchAsset,
    onRefresh,
  };
}
