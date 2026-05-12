import { useState, useEffect, useCallback } from "react";
import {
  api,
  type AssetDetail,
  type Category,
  type Location,
  type MobileCustomFieldType,
} from "@/lib/api";

/** Extract a displayable string value from a custom field's stored value */
function extractCustomFieldValue(cf: AssetDetail["customFields"][0]): string {
  const val = cf.value;
  if (val === null || val === undefined) return "";

  switch (cf.customField.type) {
    case "BOOLEAN":
      return val?.raw === true || val?.raw === "true" ? "true" : "false";
    case "DATE":
      return val?.raw ? String(val.raw) : "";
    case "OPTION":
      return val?.valueText || val?.raw || "";
    case "MULTILINE_TEXT":
      return val?.raw || val?.valueText || "";
    case "AMOUNT":
    case "NUMBER": {
      const num = val?.raw ?? val?.valueText;
      return num != null ? String(num) : "";
    }
    default:
      return val?.raw ?? val?.valueText ?? (typeof val === "string" ? val : "");
  }
}

export type CustomFieldState = {
  id: string; // customField.id
  name: string;
  type: MobileCustomFieldType;
  helpText: string | null;
  value: string; // string representation for editing
  originalValue: string;
};

export type EditAssetFormState = {
  // Loading / error
  isLoadingAsset: boolean;
  loadError: string | null;
  originalAsset: AssetDetail | null;

  // Form fields
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  selectedCategory: Category | null;
  setSelectedCategory: (v: Category | null) => void;
  selectedLocation: Location | null;
  setSelectedLocation: (v: Location | null) => void;
  valuation: string;
  setValuation: (v: string) => void;

  // Custom fields
  customFields: CustomFieldState[];
  updateCustomField: (cfId: string, newValue: string) => void;

  // Picker data
  categories: Category[];
  locations: Location[];
  isCategoriesLoading: boolean;
  isLocationsLoading: boolean;

  // Submission
  isSubmitting: boolean;
  setIsSubmitting: (v: boolean) => void;
};

export function useEditAssetForm(
  assetId: string | undefined,
  orgId: string | undefined
): EditAssetFormState {
  // ── Loading / error state ───────────────────────
  const [isLoadingAsset, setIsLoadingAsset] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [originalAsset, setOriginalAsset] = useState<AssetDetail | null>(null);

  // ── Form state ──────────────────────────────────
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(
    null
  );
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(
    null
  );
  const [valuation, setValuation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Custom fields state ───────────────────────
  const [customFields, setCustomFields] = useState<CustomFieldState[]>([]);

  // ── Picker data ─────────────────────────────────
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [isCategoriesLoading, setIsCategoriesLoading] = useState(false);
  const [isLocationsLoading, setIsLocationsLoading] = useState(false);

  // ── Load existing asset ─────────────────────────
  useEffect(() => {
    if (!assetId || !orgId) return;
    setIsLoadingAsset(true);
    api
      .asset(assetId, orgId)
      .then(({ data, error }) => {
        if (error || !data) {
          setLoadError(error || "Failed to load asset");
        } else {
          const a = data.asset;
          setOriginalAsset(a);
          setTitle(a.title);
          setDescription(a.description || "");
          if (a.category) {
            setSelectedCategory({
              id: a.category.id,
              name: a.category.name,
              color: a.category.color,
              assetCount: 0,
            });
          }
          if (a.location) {
            setSelectedLocation({
              id: a.location.id,
              name: a.location.name,
              description: null,
              image: null,
              parentId: null,
            });
          }
          if (a.valuation != null && a.valuation > 0) {
            setValuation(String(a.valuation));
          }

          // Populate custom fields
          if (a.customFields?.length) {
            const cfStates: CustomFieldState[] = a.customFields
              .filter((cf) => cf.customField.active !== false)
              .map((cf) => {
                const rawVal = extractCustomFieldValue(cf);
                return {
                  id: cf.customField.id,
                  name: cf.customField.name,
                  // why: AssetDetail's response shape declares `type: string`
                  // (kept loose to match the API contract verbatim). At this
                  // narrow construction point we know the server only emits
                  // valid MobileCustomFieldType identifiers, so we narrow
                  // here once and downstream code stays type-safe.
                  type: cf.customField.type as MobileCustomFieldType,
                  helpText: cf.customField.helpText,
                  value: rawVal,
                  originalValue: rawVal,
                };
              });
            setCustomFields(cfStates);
          }
        }
      })
      .catch(() => {
        setLoadError("Failed to load asset");
      })
      .finally(() => {
        setIsLoadingAsset(false);
      });
  }, [assetId, orgId]);

  // ── Load categories & locations ─────────────────
  const loadCategories = useCallback(async () => {
    if (!orgId) return;
    setIsCategoriesLoading(true);
    const { data } = await api.categories(orgId);
    if (data?.categories) setCategories(data.categories);
    setIsCategoriesLoading(false);
  }, [orgId]);

  const loadLocations = useCallback(async () => {
    if (!orgId) return;
    setIsLocationsLoading(true);
    const { data } = await api.locations(orgId);
    if (data?.locations) setLocations(data.locations);
    setIsLocationsLoading(false);
  }, [orgId]);

  useEffect(() => {
    loadCategories();
    loadLocations();
  }, [loadCategories, loadLocations]);

  // ── Custom field helpers ────────────────────────
  const updateCustomField = (cfId: string, newValue: string) => {
    setCustomFields((prev) =>
      prev.map((cf) => (cf.id === cfId ? { ...cf, value: newValue } : cf))
    );
  };

  return {
    isLoadingAsset,
    loadError,
    originalAsset,
    title,
    setTitle,
    description,
    setDescription,
    selectedCategory,
    setSelectedCategory,
    selectedLocation,
    setSelectedLocation,
    valuation,
    setValuation,
    customFields,
    updateCustomField,
    categories,
    locations,
    isCategoriesLoading,
    isLocationsLoading,
    isSubmitting,
    setIsSubmitting,
  };
}
