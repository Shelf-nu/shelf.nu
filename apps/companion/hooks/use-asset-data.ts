import { useState, useEffect, useCallback } from "react";
import { api, type AssetDetail } from "@/lib/api";
import { announce } from "@/lib/a11y";

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

export function useAssetData(assetId: string): UseAssetDataReturn {
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAsset = useCallback(async () => {
    const { data, error: fetchErr } = await api.asset(assetId);
    // Request cancelled (navigation) — ignore
    if (!data && !fetchErr) return;
    if (fetchErr || !data) {
      setError(fetchErr || "Failed to load asset details");
      setAsset(null);
    } else {
      setAsset(data.asset);
      setError(null);
    }
  }, [assetId]);

  useEffect(() => {
    setIsLoading(true);
    fetchAsset().finally(() => setIsLoading(false));
  }, [fetchAsset]);

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
