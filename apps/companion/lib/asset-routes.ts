/**
 * Where the asset screens (asset detail, edit asset, kit detail) live in each
 * tab stack that shows them.
 *
 * The Assets tab owns these screens. The Audits stack mounts the very same
 * components under its own routes (`app/(tabs)/audits/asset/[id].tsx`,
 * `asset/edit.tsx`, `kit/[id].tsx`), so an asset opened from an audit row is
 * pushed on top of that audit. The header back button, the iOS swipe and the
 * Android back button are then all a plain pop back to the audit, with its
 * filter and scroll intact. The Assets tab's route would switch tabs instead,
 * and back would land on the Assets list, with no way back to the audit short
 * of Home > Audits > the audit again.
 *
 * A screen mounted in a stack must keep its own pushes in that stack too:
 * pushing the Assets tab's edit or kit route from inside the Audits stack
 * switches tabs and leaves that screen on the Assets tab's stack, which then
 * opens on it instead of its list. Every push between these screens goes
 * through the hrefs below, keyed by the stack the screen is mounted in.
 *
 * Pure and free of React Native, Expo and `@/` paths so it runs under Node's
 * test runner; `asset-host-stack.tsx` provides the stack and navigates.
 *
 * @see {@link file://./asset-routes.test.ts}
 * @see {@link file://./asset-host-stack.tsx} the context and navigation hook
 * @see {@link file://../app/(tabs)/audits/asset/[id].tsx} the Audits mount
 */

/** The tab stacks that mount the asset screens. */
export type AssetHostStack = "assets" | "audits";

/**
 * Route pattern of each asset screen, per host stack. Each pattern is the
 * route file's path under `app/` without the extension.
 */
export const ASSET_SCREEN_ROUTES = {
  assets: {
    detail: "/(tabs)/assets/[id]",
    edit: "/(tabs)/assets/edit",
    kit: "/(tabs)/assets/kits/[id]",
  },
  audits: {
    detail: "/(tabs)/audits/asset/[id]",
    edit: "/(tabs)/audits/asset/edit",
    kit: "/(tabs)/audits/kit/[id]",
  },
} as const;

/** One of the asset screens a host stack mounts. */
export type AssetScreen = keyof (typeof ASSET_SCREEN_ROUTES)[AssetHostStack];

/**
 * Href of the asset detail screen inside the given stack.
 *
 * @param stack - The stack the navigation starts from and must stay in
 * @param assetId - The asset to open
 * @returns An expo-router href object for `router.push`
 */
export function assetDetailHref(stack: AssetHostStack, assetId: string) {
  return {
    pathname: ASSET_SCREEN_ROUTES[stack].detail,
    params: { id: assetId },
  };
}

/**
 * Href of the edit asset screen inside the given stack. The edit screen reads
 * the asset id from the `id` search param and returns with `router.back()`,
 * so it lands on the asset detail it was opened from.
 *
 * @param stack - The stack the navigation starts from and must stay in
 * @param assetId - The asset to edit
 * @returns An expo-router href object for `router.push`
 */
export function assetEditHref(stack: AssetHostStack, assetId: string) {
  return {
    pathname: ASSET_SCREEN_ROUTES[stack].edit,
    params: { id: assetId },
  };
}

/**
 * Href of the kit detail screen inside the given stack.
 *
 * @param stack - The stack the navigation starts from and must stay in
 * @param kitId - The kit to open
 * @returns An expo-router href object for `router.push`
 */
export function kitDetailHref(stack: AssetHostStack, kitId: string) {
  return {
    pathname: ASSET_SCREEN_ROUTES[stack].kit,
    params: { id: kitId },
  };
}
