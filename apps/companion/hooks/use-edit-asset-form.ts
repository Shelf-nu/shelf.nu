/**
 * useEditAssetForm
 *
 * Centralises all state and side-effects for the asset edit screen:
 *   - Loads the existing asset (title / description / category / location /
 *     valuation) into editable form fields.
 *   - Loads the org's full active custom-field definitions, scoped to the
 *     asset's category, and joins them with the asset's saved values to
 *     produce the rendered field list (so fields the asset has never had
 *     a value for still appear, just like on the create screen).
 *   - Tracks the user's unsaved edits separately from the asset's saved
 *     values so a category switch (which reloads the defs) can preserve
 *     keystrokes for fields still in scope.
 *   - Loads picker data (categories, locations) for the select inputs.
 *
 * Owned by `apps/companion/app/(tabs)/assets/edit.tsx`. The hook returns a
 * single state-shape object (`EditAssetFormState`) instead of N tuples so
 * the screen can spread / destructure cleanly.
 *
 * @see {@link file://../../app/(tabs)/assets/edit.tsx EditAssetScreen}
 * @see {@link file://../components/asset-edit/custom-field-input.tsx CustomFieldInput}
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  api,
  type AssetDetail,
  type Category,
  type Location,
  type MobileCustomFieldDefinition,
  type MobileCustomFieldType,
} from "@/lib/api";

/**
 * Extract a displayable string value from a custom field's stored value.
 *
 * The webapp persists each custom field as a `{ raw, valueText }` blob
 * whose shape depends on `customField.type`. This helper normalises it to
 * the string form the mobile form inputs work with.
 *
 * @param cf  An entry from `AssetDetail.customFields`.
 * @returns   The string the user should see in the input. Empty string
 *            when the field has no value yet.
 */
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

/**
 * Per-field state rendered by the edit form's custom-fields section.
 *
 * Joined from three sources in the hook:
 *   - `id` / `name` / `type` / `helpText` / `required` / `options` come from
 *     the org's `MobileCustomFieldDefinition` (so we know required-ness
 *     and OPTION choices regardless of whether the asset has a saved value).
 *   - `originalValue` is the asset's saved value at load time, used by
 *     `useFormValidation` to detect dirty state for the unsaved-changes guard.
 *   - `value` reflects the user's in-progress edit (falls back to
 *     `originalValue` when the user hasn't touched the field).
 */
export type CustomFieldState = {
  /** The customField (definition) id, NOT the asset's AssetCustomFieldValue id. */
  id: string;
  /** Human-readable label rendered above the input. */
  name: string;
  /** Field type — drives which `CustomFieldInput` branch renders. */
  type: MobileCustomFieldType;
  /** Optional hint shown next to the label and as `accessibilityHint`. */
  helpText: string | null;
  /** Sourced from the org's custom-field definition, not from the asset. */
  required: boolean;
  /** Allowed values for OPTION fields; null/empty for every other type. */
  options: string[] | null;
  /** Current string value the user is editing. */
  value: string;
  /** Original saved value at load time. Used to detect dirty state. */
  originalValue: string;
};

/**
 * The full state surface `useEditAssetForm` returns to the edit screen.
 *
 * Grouped by concern (loading, form fields, custom fields, picker data,
 * submission). The screen destructures whatever it needs; nothing here is
 * optional — every field is always present.
 */
export type EditAssetFormState = {
  /** True while the initial asset fetch is in flight. */
  isLoadingAsset: boolean;
  /** Asset-load failure message; null on success. */
  loadError: string | null;
  /** The asset as returned by the server. Used as the baseline for diffs. */
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
  /** Derived: org defs ⨯ asset saved values ⨯ user's in-progress edits. */
  customFields: CustomFieldState[];
  /** Update a single custom field's in-progress edit. */
  updateCustomField: (cfId: string, newValue: string) => void;
  /** True while custom-field definitions are being fetched. */
  isCustomFieldsLoading: boolean;
  /** Custom-fields fetch failure message; null on success. */
  customFieldsError: string | null;
  /** Manual retry trigger for the defs fetch. */
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

/**
 * Initialise the asset edit form.
 *
 * Performs three independent fetches (asset detail, categories, locations)
 * plus a fourth that depends on the asset's category (custom-field defs).
 * Returns a stable state-shape object the screen renders from.
 *
 * @param assetId The asset id from the route param. The hook is a no-op
 *                until both this and `orgId` are defined.
 * @param orgId   The active organisation id from `useOrg`. Must match the
 *                org the asset belongs to (the asset endpoint enforces this).
 * @returns       The full edit-form state surface — see {@link EditAssetFormState}.
 */
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
    // why: clear the stale defs at the start of each fetch so the
    // `customFields` useMemo briefly returns `[]` during the reload
    // window. Without this, a category change shows fields from the
    // OLD category until the new fetch resolves, and any keystrokes the
    // user makes in that window are keyed by the old defs' ids and
    // become orphaned once the new defs land. `customFieldEdits` is
    // intentionally NOT cleared — keystrokes for fields that survive
    // the category change (same id) should be preserved across the
    // reload (the documented behaviour above).
    setCustomFieldDefs([]);
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
