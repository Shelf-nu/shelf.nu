import EditAssetScreen from "@/app/(tabs)/assets/edit";
import { AssetHostStackProvider } from "@/lib/asset-host-stack";

/**
 * The edit asset form, mounted in the Audits stack. Opened from the asset
 * detail when that detail was opened from an audit row.
 *
 * The same screen as the Assets tab's. Saving or cancelling calls
 * `router.back()`, which pops to the asset detail below it in this stack, and
 * one more back returns to the audit. The Assets tab's stack is never touched.
 *
 * @see {@link file://../../../../lib/asset-routes.ts} why the screen is mounted twice
 * @returns The edit form for the `id` search param
 */
export default function AuditEditAssetScreen() {
  return (
    <AssetHostStackProvider stack="audits">
      <EditAssetScreen />
    </AssetHostStackProvider>
  );
}
