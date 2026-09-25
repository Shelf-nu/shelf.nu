import { useState } from "react";
import { Alert } from "react-native";
import * as Haptics from "expo-haptics";
import { api, type AssetDetail, type TeamMember } from "@/lib/api";
import { useSheetSubmit } from "@/hooks/use-sheet-submit";

interface UseCustodyActionsParams {
  asset: AssetDetail | null;
  currentOrg: { id: string } | null;
  fetchAsset: () => Promise<void>;
  /**
   * SELF_SERVICE users can only ever take custody for themselves, so their
   * confirm says "Take" rather than naming a custodian to assign to.
   */
  isSelfService?: boolean;
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
   *
   * The request runs with the sheet still open. `closeSheet` runs only once
   * the server accepts the assignment, so a refusal leaves the entered
   * quantity on screen.
   */
  performAssignQuantity: (
    member: TeamMember,
    quantity: number,
    closeSheet: () => void
  ) => Promise<void>;
  /**
   * Release `quantity` units of a QUANTITY_TRACKED asset from the custodian
   * identified by `custodianId` (team-member id). Confirmed by the sheet, and
   * closes it only once accepted, same as `performAssignQuantity`.
   *
   * `consumed` records how many of those units were used up rather than
   * handed back. Pass `undefined` and the server derives the outcome from the
   * asset's consumptionType.
   */
  performReleaseQuantity: (
    custodianId: string,
    quantity: number,
    consumed: number | undefined,
    closeSheet: () => void
  ) => Promise<void>;
}

export function useCustodyActions({
  asset,
  currentOrg,
  fetchAsset,
  isSelfService = false,
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
      isSelfService ? "Take Custody" : "Assign Custody",
      isSelfService
        ? `Take custody of "${asset?.title}"?`
        : `Assign "${asset?.title}" to ${displayName}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isSelfService ? "Take" : "Assign",
          onPress: () => performAssign(member.id),
        },
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
  // The QuantityInputSheet's explicit submit replaces the Alert confirm step
  // (the sheet already shows amount + custodian + unit). The request runs with
  // the sheet still open, and the sheet closes only once the server accepts;
  // the detail refetch (fetchAsset) then refreshes quantityBreakdown,
  // custodyList, and status in one shot.
  const submitFromSheet = useSheetSubmit({
    refresh: fetchAsset,
    setSubmitting: setIsActionLoading,
  });

  const performAssignQuantity = async (
    member: TeamMember,
    quantity: number,
    closeSheet: () => void
  ) => {
    if (!currentOrg || !asset) return;
    const orgId = currentOrg.id;
    const assetId = asset.id;
    await submitFromSheet(
      () => api.assignQuantityCustody(orgId, assetId, member.id, quantity),
      closeSheet
    );
  };

  const performReleaseQuantity = async (
    custodianId: string,
    quantity: number,
    consumed: number | undefined,
    closeSheet: () => void
  ) => {
    if (!currentOrg || !asset) return;
    const orgId = currentOrg.id;
    const assetId = asset.id;
    await submitFromSheet(
      () =>
        api.releaseQuantityCustody(orgId, assetId, custodianId, quantity, {
          consumed,
        }),
      closeSheet
    );
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
