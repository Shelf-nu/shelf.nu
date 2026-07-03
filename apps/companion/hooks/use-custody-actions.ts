import { useState } from "react";
import { Alert } from "react-native";
import * as Haptics from "expo-haptics";
import { api, type AssetDetail, type TeamMember } from "@/lib/api";

interface UseCustodyActionsParams {
  asset: AssetDetail | null;
  currentOrg: { id: string } | null;
  fetchAsset: () => Promise<void>;
}

interface UseCustodyActionsReturn {
  isActionLoading: boolean;
  setIsActionLoading: React.Dispatch<React.SetStateAction<boolean>>;
  handleAssignCustody: (member: TeamMember) => void;
  handleReleaseCustody: () => void;
  /**
   * Assign `quantity` units of a QUANTITY_TRACKED asset to `member`.
   * No Alert confirm step: the QuantityInputSheet's explicit submit IS the
   * confirmation (a second Alert would be double-confirmation).
   */
  performAssignQuantity: (
    member: TeamMember,
    quantity: number
  ) => Promise<void>;
  /**
   * Release `quantity` units of a QUANTITY_TRACKED asset from the custodian
   * identified by `custodianId` (team-member id). Confirmed by the sheet,
   * same as `performAssignQuantity`.
   */
  performReleaseQuantity: (
    custodianId: string,
    quantity: number
  ) => Promise<void>;
}

export function useCustodyActions({
  asset,
  currentOrg,
  fetchAsset,
}: UseCustodyActionsParams): UseCustodyActionsReturn {
  const [isActionLoading, setIsActionLoading] = useState(false);

  const performAssign = async (custodianId: string) => {
    if (!currentOrg || !asset) return;
    setIsActionLoading(true);
    try {
      const { error: err } = await api.assignCustody(
        currentOrg.id,
        asset.id,
        custodianId
      );
      if (err) Alert.alert("Error", err);
      else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await fetchAsset();
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

    Alert.alert(
      "Assign Custody",
      `Assign "${asset?.title}" to ${displayName}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Assign", onPress: () => performAssign(member.id) },
      ]
    );
  };

  const performRelease = async () => {
    if (!currentOrg || !asset) return;
    setIsActionLoading(true);
    try {
      const { error: err } = await api.releaseCustody(currentOrg.id, asset.id);
      if (err) Alert.alert("Error", err);
      else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await fetchAsset();
      }
    } catch {
      Alert.alert("Error", "Something went wrong");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleReleaseCustody = () => {
    if (!asset?.custody) return;
    Alert.alert(
      "Release Custody",
      `Release "${asset.title}" from ${asset.custody.custodian.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Release", style: "destructive", onPress: performRelease },
      ]
    );
  };

  // ── Quantity-custody actions (QUANTITY_TRACKED assets only) ──────────
  // Same success/error shape as performAssign/performRelease above, but the
  // Alert confirm step is replaced by the QuantityInputSheet's explicit
  // submit (the sheet already shows amount + custodian + unit). On success
  // the detail refetch (fetchAsset) refreshes quantityBreakdown, custodyList,
  // and status in one shot.

  const performAssignQuantity = async (
    member: TeamMember,
    quantity: number
  ) => {
    if (!currentOrg || !asset) return;
    setIsActionLoading(true);
    try {
      const { error: err } = await api.assignQuantityCustody(
        currentOrg.id,
        asset.id,
        member.id,
        quantity
      );
      if (err) Alert.alert("Error", err);
      else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await fetchAsset();
      }
    } catch {
      Alert.alert("Error", "Something went wrong");
    } finally {
      setIsActionLoading(false);
    }
  };

  const performReleaseQuantity = async (
    custodianId: string,
    quantity: number
  ) => {
    if (!currentOrg || !asset) return;
    setIsActionLoading(true);
    try {
      const { error: err } = await api.releaseQuantityCustody(
        currentOrg.id,
        asset.id,
        custodianId,
        quantity
      );
      if (err) Alert.alert("Error", err);
      else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await fetchAsset();
      }
    } catch {
      Alert.alert("Error", "Something went wrong");
    } finally {
      setIsActionLoading(false);
    }
  };

  return {
    isActionLoading,
    setIsActionLoading,
    handleAssignCustody,
    handleReleaseCustody,
    performAssignQuantity,
    performReleaseQuantity,
  };
}
