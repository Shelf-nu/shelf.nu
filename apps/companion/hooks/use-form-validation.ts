import { useMemo } from "react";
import { Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { usePreventRemove } from "@react-navigation/native";
import type { AssetDetail, Category, Location } from "@/lib/api";
import type { CustomFieldState } from "./use-edit-asset-form";

type FormValidationArgs = {
  title: string;
  description: string;
  selectedCategory: Category | null;
  selectedLocation: Location | null;
  valuation: string;
  customFields: CustomFieldState[];
  originalAsset: AssetDetail | null;
  isSubmitting: boolean;
};

/**
 * Tracks dirty state for the edit asset form and warns on navigation
 * if there are unsaved changes.
 */
export function useFormValidation({
  title,
  description,
  selectedCategory,
  selectedLocation,
  valuation,
  customFields,
  originalAsset,
  isSubmitting,
}: FormValidationArgs): { isDirty: boolean } {
  const navigation = useNavigation();

  const isDirty = useMemo(() => {
    if (!originalAsset) return false;
    if (title.trim() !== originalAsset.title) return true;
    if (description.trim() !== (originalAsset.description || "")) return true;
    if ((selectedCategory?.id || null) !== (originalAsset.category?.id || null))
      return true;
    if ((selectedLocation?.id || null) !== (originalAsset.location?.id || null))
      return true;
    const numVal = valuation.trim() ? parseFloat(valuation.trim()) : null;
    if (numVal !== (originalAsset.valuation ?? null)) return true;
    if (customFields.some((cf) => cf.value !== cf.originalValue)) return true;
    return false;
  }, [
    title,
    description,
    selectedCategory,
    selectedLocation,
    valuation,
    customFields,
    originalAsset,
  ]);

  // Warn on back navigation if there are unsaved changes
  usePreventRemove(isDirty && !isSubmitting, ({ data }) => {
    Alert.alert(
      "Discard Changes?",
      "You have unsaved changes. Are you sure you want to go back?",
      [
        { text: "Keep Editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => navigation.dispatch(data.action),
        },
      ]
    );
  });

  return { isDirty };
}
