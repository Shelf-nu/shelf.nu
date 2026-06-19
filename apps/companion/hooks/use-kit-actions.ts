/**
 * useKitActions — custody (assign/release) and location actions for the kit
 * detail screen, run through the existing `kits.bulk-actions` mobile endpoint
 * (one kit at a time). Mirrors the asset `useCustodyActions` hook + the asset
 * screen's location action, so kit and asset detail behave identically.
 *
 * @see {@link file://./use-custody-actions.ts} the asset twin
 * @see {@link file://../lib/api/kits.ts} the bulk-action API wrappers
 */
import { useState } from "react";
import { Alert } from "react-native";
import * as Haptics from "expo-haptics";
import { api, type TeamMember, type Location } from "@/lib/api";
import type { KitDetail } from "@/lib/api/types";

interface UseKitActionsParams {
  kit: KitDetail | null;
  currentOrg: { id: string } | null;
  fetchKit: () => Promise<void>;
}

interface UseKitActionsReturn {
  isActionLoading: boolean;
  handleAssignCustody: (member: TeamMember) => void;
  handleReleaseCustody: () => void;
  handleUpdateLocation: (location: Location) => void;
}

/**
 * Wires the kit detail screen's custody + location actions.
 *
 * @param params - The current kit, org, and a refetch callback.
 * @returns Action handlers + the in-flight loading flag.
 */
export function useKitActions({
  kit,
  currentOrg,
  fetchKit,
}: UseKitActionsParams): UseKitActionsReturn {
  const [isActionLoading, setIsActionLoading] = useState(false);

  const performAssign = async (custodianId: string) => {
    if (!currentOrg || !kit) return;
    setIsActionLoading(true);
    try {
      const { error: err } = await api.bulkAssignKitCustody(
        currentOrg.id,
        [kit.id],
        custodianId
      );
      if (err) Alert.alert("Error", err);
      else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await fetchKit();
      }
    } catch {
      Alert.alert("Error", "Something went wrong");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleAssignCustody = (member: TeamMember) => {
    const displayName = member.user
      ? [member.user.firstName, member.user.lastName]
          .filter(Boolean)
          .join(" ") || member.name
      : member.name;

    Alert.alert("Assign Custody", `Assign "${kit?.name}" to ${displayName}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Assign", onPress: () => performAssign(member.id) },
    ]);
  };

  const performRelease = async () => {
    if (!currentOrg || !kit) return;
    setIsActionLoading(true);
    try {
      const { error: err } = await api.bulkReleaseKitCustody(currentOrg.id, [
        kit.id,
      ]);
      if (err) Alert.alert("Error", err);
      else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await fetchKit();
      }
    } catch {
      Alert.alert("Error", "Something went wrong");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleReleaseCustody = () => {
    if (!kit?.custody) return;
    Alert.alert(
      "Release Custody",
      `Release "${kit.name}" from ${kit.custody.custodian.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Release", style: "destructive", onPress: performRelease },
      ]
    );
  };

  const performUpdateLocation = async (locationId: string) => {
    if (!currentOrg || !kit) return;
    setIsActionLoading(true);
    try {
      const { error: err } = await api.bulkUpdateKitLocation(
        currentOrg.id,
        [kit.id],
        locationId
      );
      if (err) Alert.alert("Error", err);
      else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await fetchKit();
      }
    } catch {
      Alert.alert("Error", "Something went wrong");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleUpdateLocation = (location: Location) => {
    if (location.id === kit?.location?.id) return; // same location — no-op
    Alert.alert("Update Location", `Move "${kit?.name}" to ${location.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Move", onPress: () => performUpdateLocation(location.id) },
    ]);
  };

  return {
    isActionLoading,
    handleAssignCustody,
    handleReleaseCustody,
    handleUpdateLocation,
  };
}
