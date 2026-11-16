import AssetDetailScreen from "@/app/(tabs)/assets/[id]";
import { AssetHostStackProvider } from "@/lib/asset-host-stack";

/**
 * The asset detail, mounted in the Audits stack. Opened from an audit row.
 *
 * The same screen as the Assets tab's, pushed on top of the audit instead of
 * switching tabs, so the header back button, the iOS swipe and the Android
 * back button all return to the audit with its filter and scroll intact. The
 * provider keeps the screen's own pushes (edit, kit) in this stack as well.
 *
 * @see {@link file://../../../../lib/asset-routes.ts} why the screen is mounted twice
 * @returns The asset detail screen for the `id` route param
 */
export default function AuditAssetDetailScreen() {
  return (
    <AssetHostStackProvider stack="audits">
      <AssetDetailScreen />
    </AssetHostStackProvider>
  );
}
