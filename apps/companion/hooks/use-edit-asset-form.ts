import { useState, useEffect, useCallback, useMemo } from "react";
import {
  api,
  type AssetDetail,
  type Category,
  type Location,
  type MobileCustomFieldDefinition,
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
  /** Sourced from the org's custom-field definition, not from the asset. */
  required: boolean;
  /** Allowed values for OPTION fields; null/empty for every other type. */
  options: string[] | null;
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
  isCustomFieldsLoading: boolean;
  customFieldsError: string | null;
  retryLoadCustomFields: () => void;

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
  // Org-scoped definitions (full list, filtered by selected category).
  // Sourced from `api.customFields` — NOT from the asset, so we see fields
  // the asset has never had a value for. Required-ness and OPTION choices
  // live here too.
  const [customFieldDefs, setCustomFieldDefs] = useState<
    MobileCustomFieldDefinition[]
  >([]);
  const [isCustomFieldsLoading, setIsCustomFieldsLoading] = useState(false);
  // why: surfacing the fetch failure is critical — without it the required-
  // field client guard silently becomes a no-op on an empty defs array,
  // letting the user submit a payload the server then rejects.
  const [customFieldsError, setCustomFieldsError] = useState<string | null>(
    null
  );
  // Manual retry trigger for the defs fetch (analogous to new.tsx).
  const [customFieldsRetryNonce, setCustomFieldsRetryNonce] = useState(0);

  // In-progress user edits keyed by customField id. Kept separately from
  // the asset's saved values so a category change (which reloads the defs)
  // doesn't blow away the user's unsaved typing for fields still in scope.
  const [customFieldEdits, setCustomFieldEdits] = useState<
    Record<string, string>
  >({});

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
          // why: custom-field state is now derived from `customFieldDefs`
          // (the org's full active set, filtered by the asset's category)
          // joined with the asset's saved values. Population happens in the
          // `customFields` useMemo below — not here — so that fields the
          // asset has never had a value for still render on the form.
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

  // ── Load custom field definitions ───────────────
  // Mirrors `new.tsx` so the edit screen sees the full set of applicable
  // org custom fields (not just those the asset has a saved value for),
  // and so `required` / `options` come straight from the server contract.
  useEffect(() => {
    if (!orgId) return;
    const controller = new AbortController();
    setIsCustomFieldsLoading(true);
    setCustomFieldsError(null);
    api
      .customFields(orgId, selectedCategory?.id, controller.signal)
      .then(({ data, error }) => {
        if (controller.signal.aborted) return;
        if (error) {
          setCustomFieldsError(error);
          return;
        }
        setCustomFieldDefs(data?.customFields ?? []);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setCustomFieldsError(
          err instanceof Error
            ? err.message
            : "Failed to load custom fields. Please retry."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsCustomFieldsLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [orgId, selectedCategory?.id, customFieldsRetryNonce]);

  const retryLoadCustomFields = useCallback(() => {
    setCustomFieldsRetryNonce((n) => n + 1);
  }, []);

  // ── Custom field helpers ────────────────────────
  // Derived state: join org defs with the asset's saved values + the user's
  // unsaved edits. Defs are the source of truth for name / type / required /
  // options / helpText; the asset provides `originalValue` (per-field
  // baseline used by `useFormValidation` to detect dirty state); the edits
  // map provides the live value while the user is typing.
  const customFields = useMemo<CustomFieldState[]>(() => {
    if (!originalAsset) return [];
    return customFieldDefs.map((def) => {
      const existing = originalAsset.customFields.find(
        (cf) => cf.customField.id === def.id
      );
      const originalValue = existing ? extractCustomFieldValue(existing) : "";
      return {
        id: def.id,
        name: def.name,
        type: def.type,
        helpText: def.helpText,
        required: def.required,
        options: def.options,
        // Prefer the live edit; fall back to the asset's saved value.
        value: customFieldEdits[def.id] ?? originalValue,
        originalValue,
      };
    });
  }, [customFieldDefs, customFieldEdits, originalAsset]);

  const updateCustomField = useCallback((cfId: string, newValue: string) => {
    setCustomFieldEdits((prev) => ({ ...prev, [cfId]: newValue }));
  }, []);

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
    isCustomFieldsLoading,
    customFieldsError,
    retryLoadCustomFields,
    categories,
    locations,
    isCategoriesLoading,
    isLocationsLoading,
    isSubmitting,
    setIsSubmitting,
  };
}
