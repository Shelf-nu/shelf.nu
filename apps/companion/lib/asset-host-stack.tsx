import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "expo-router";
import { pushIntoTab } from "./navigation";
import {
  assetDetailHref,
  assetEditHref,
  kitDetailHref,
  type AssetHostStack,
} from "./asset-routes";

/**
 * Which tab stack the current asset screen is mounted in.
 *
 * Defaults to "assets": the Assets tab owns the asset screens and mounts them
 * without a provider. Another stack that mounts them (the Audits stack) wraps
 * each route in {@link AssetHostStackProvider}.
 */
const AssetHostStackContext = createContext<AssetHostStack>("assets");

/**
 * Marks the asset screen below as mounted in `stack`, so its pushes (edit,
 * kit, an asset from a kit) stay in that stack. See `lib/asset-routes.ts`.
 *
 * @param props.stack - The tab stack whose route renders the children
 * @param props.children - The asset screen
 * @returns The children inside the context provider
 */
export function AssetHostStackProvider({
  stack,
  children,
}: {
  stack: AssetHostStack;
  children: ReactNode;
}) {
  return (
    <AssetHostStackContext.Provider value={stack}>
      {children}
    </AssetHostStackContext.Provider>
  );
}

/**
 * Navigation between the asset screens that keeps the user in the stack the
 * current screen is mounted in, so native back (header button, iOS swipe,
 * Android back button) retraces the same path.
 *
 * In the Assets tab each call opens the Assets tab's own route. In the Audits
 * stack each call pushes the Audits-mounted route instead, so nothing lands
 * on the Assets tab's stack.
 *
 * @returns `openAsset`, `openEdit` and `openKit`, stable while the stack and
 *   router are
 */
export function useAssetScreenNavigation() {
  const stack = useContext(AssetHostStackContext);
  const router = useRouter();

  return useMemo(
    () => ({
      /**
       * Opens an asset's detail (from a kit's asset list).
       *
       * @param assetId - The asset to open
       */
      openAsset: (assetId: string) => {
        if (stack === "assets") {
          // The anchored navigate every cross-surface asset link uses, so the
          // Assets list always sits beneath the asset.
          pushIntoTab("/(tabs)/assets", assetDetailHref(stack, assetId));
        } else {
          router.push(assetDetailHref(stack, assetId));
        }
      },
      /**
       * Opens the edit form for an asset.
       *
       * @param assetId - The asset to edit
       */
      openEdit: (assetId: string) => {
        router.push(assetEditHref(stack, assetId));
      },
      /**
       * Opens a kit's detail.
       *
       * @param kitId - The kit to open
       */
      openKit: (kitId: string) => {
        router.push(kitDetailHref(stack, kitId));
      },
    }),
    [stack, router]
  );
}
