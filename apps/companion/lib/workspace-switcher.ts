/**
 * The workspace switcher: a native list of the person's workspaces, with the
 * open one and any inactive one marked. Settings and the inactive-workspace
 * screen both open it, so the two always offer the same list.
 *
 * @see app/(tabs)/settings/index.tsx
 * @see components/inactive-workspace-screen.tsx
 */
import { Alert } from "react-native";
import * as Haptics from "expo-haptics";
import type { Organization } from "./api";
import { workspaceSwitchLabel } from "./workspace-access";

/**
 * Opens the switcher.
 *
 * @param args.organizations - Every workspace, as `/api/mobile/me` lists them.
 * @param args.currentOrg - The workspace open now.
 * @param args.onSelect - Called with the workspace the person picks.
 */
export function openWorkspaceSwitcher({
  organizations,
  currentOrg,
  onSelect,
}: {
  organizations: readonly Organization[];
  currentOrg: Organization | null;
  onSelect: (org: Organization) => void;
}): void {
  Alert.alert("Switch Workspace", "Select a workspace:", [
    ...organizations.map((org) => ({
      text: workspaceSwitchLabel(org, currentOrg?.id),
      onPress: () => {
        Haptics.selectionAsync();
        onSelect(org);
      },
    })),
    { text: "Cancel", style: "cancel" as const },
  ]);
}
