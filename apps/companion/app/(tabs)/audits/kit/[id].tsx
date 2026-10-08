import KitDetailScreen from "@/app/(tabs)/assets/kits/[id]";
import { AssetHostStackProvider } from "@/lib/asset-host-stack";

/**
 * The kit detail, mounted in the Audits stack. Opened from the Kit row of an
 * asset detail that was itself opened from an audit row.
 *
 * The same screen as the Assets tab's. Its asset rows push the Audits-mounted
 * asset detail, so back walks the same path down to the audit.
 *
 * @see {@link file://../../../../lib/asset-routes.ts} why the screen is mounted twice
 * @returns The kit detail screen for the `id` route param
 */
export default function AuditKitDetailScreen() {
  return (
    <AssetHostStackProvider stack="audits">
      <KitDetailScreen />
    </AssetHostStackProvider>
  );
}
