/**
 * What a tab shows while the open workspace is inactive.
 *
 * The mobile API refuses every request in an inactive workspace (a lapsed Team
 * plan, or switched off by a Shelf admin), so each screen would otherwise show
 * its own generic error. This one screen says what is going on, in the
 * server's words, and offers the way out: another workspace, or a fresh check.
 * It never points at a purchase; the owner sorts that out on the web.
 *
 * Settings stays open beside it, so the person can still switch workspace,
 * change preferences and sign out.
 *
 * @see app/(tabs)/_layout.tsx, the one place this renders
 * @see lib/workspace-access.ts
 */
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  FullScreenNotice,
  NoticeButton,
  NoticeText,
} from "@/components/full-screen-notice";
import type { Organization } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import {
  inactiveWorkspaceMessage,
  isWorkspaceInactive,
} from "@/lib/workspace-access";
import { openWorkspaceSwitcher } from "@/lib/workspace-switcher";

/**
 * @param props.org - The open workspace, which is inactive.
 * @param props.underHeader - Whether the tab draws a header above this screen.
 *   Without one, the screen keeps clear of the status bar itself.
 */
export default function InactiveWorkspaceScreen({
  org,
  underHeader,
}: {
  org: Organization;
  underHeader: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { organizations, currentOrg, setCurrentOrg, refresh } = useOrg();
  const [isChecking, setIsChecking] = useState(false);
  const canSwitch = organizations.some(
    (other) => other.id !== org.id && !isWorkspaceInactive(other)
  );

  /**
   * Re-reads `/me`. Once the workspace is active again, the tab layout stops
   * rendering this screen, so there is no success state to show here.
   */
  const handleCheckAgain = async () => {
    setIsChecking(true);
    try {
      await refresh({ silent: true });
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <FullScreenNotice
      icon="pause-circle-outline"
      title="This workspace is inactive"
      style={underHeader ? undefined : { paddingTop: insets.top }}
    >
      <NoticeText variant="emphasis">{org.name}</NoticeText>
      <NoticeText>{inactiveWorkspaceMessage(org)}</NoticeText>

      {canSwitch && (
        <NoticeButton
          label="Switch workspace"
          accessibilityLabel="Switch to another workspace"
          onPress={() =>
            openWorkspaceSwitcher({
              organizations,
              currentOrg,
              onSelect: setCurrentOrg,
            })
          }
        />
      )}

      <NoticeButton
        label="Check again"
        accessibilityLabel="Check again whether this workspace is active"
        onPress={handleCheckAgain}
        variant={canSwitch ? "secondary" : "primary"}
        busy={isChecking}
      />
    </FullScreenNotice>
  );
}
