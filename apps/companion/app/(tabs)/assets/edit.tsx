/**
 * EditAssetScreen
 *
 * Asset edit form for the mobile companion. Mirrors the create flow
 * (`assets/new.tsx`) but starts from a server-loaded baseline and submits
 * a partial-update payload containing only changed fields. Hooks into
 * `useEditAssetForm` for state, `useFormValidation` for the dirty-state
 * unsaved-changes guard, and `CustomFieldInput` (shared with create) for
 * each custom-field row.
 *
 * @see {@link file://../../../hooks/use-edit-asset-form.ts useEditAssetForm}
 * @see {@link file://../../../components/asset-edit/custom-field-input.tsx CustomFieldInput}
 */
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { api, type MobileCustomFieldType } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { labelForRequired } from "@/lib/a11y";
import { useEditAssetForm } from "@/hooks/use-edit-asset-form";
import { useFormValidation } from "@/hooks/use-form-validation";
import { PickerField } from "@/components/asset-edit/picker-field";
import { CustomFieldInput } from "@/components/asset-edit/custom-field-input";
import { ValuationField } from "@/components/asset-edit/valuation-field";

/** The shape the server expects for a single custom-field update entry. */
type CustomFieldPayloadValue = { raw: string | number | boolean } | null;

/**
 * Build the JSON value payload for a single custom field update.
 *
 * Returns `null` for empty values so the server clears the field. For
 * NUMBER / AMOUNT, a non-numeric string parses to `null` (treated as a
 * clear) so the user can't ship a malformed number to the server.
 *
 * @param type  The field's declared type from the canonical
 *              `MobileCustomFieldType` union — narrowed so the switch is
 *              exhaustively checkable.
 * @param value The string value from the form input.
 * @returns     `{ raw: ... }` on success, or `null` to clear the field.
 */
function buildCustomFieldPayloadValue(
  type: MobileCustomFieldType,
  value: string
): CustomFieldPayloadValue {
  if (!value.trim()) return null; // null to clear the field

  switch (type) {
    case "BOOLEAN":
      return { raw: value === "true" };
    case "DATE":
      return { raw: value };
    case "AMOUNT":
    case "NUMBER": {
      const num = parseFloat(value);
      return isNaN(num) ? null : { raw: num };
    }
    case "TEXT":
    case "MULTILINE_TEXT":
    case "OPTION":
      return { raw: value };
  }
}

/**
 * The asset edit screen rendered at `/assets/[id]/edit`.
 *
 * Loads the asset + custom-field definitions, renders the editable form,
 * validates required fields client-side before submit, and dispatches a
 * partial-update payload through `api.updateAsset` containing only the
 * fields that actually changed (so the server's audit log stays clean).
 *
 * @returns The edit form JSX, or a centered loading / error placeholder
 *          while the asset is being fetched.
 */
export default function EditAssetScreen() {
  const router = useRouter();
  const { id: assetId } = useLocalSearchParams<{ id: string }>();
  const { currentOrg } = useOrg();
  const { colors } = useTheme();
  const styles = useStyles();

  const form = useEditAssetForm(assetId, currentOrg?.id);

  const { isDirty } = useFormValidation({
    title: form.title,
    description: form.description,
    selectedCategory: form.selectedCategory,
    selectedLocation: form.selectedLocation,
    valuation: form.valuation,
    customFields: form.customFields,
    originalAsset: form.originalAsset,
    isSubmitting: form.isSubmitting,
  });

  // ── Submit ──────────────────────────────────────
  const handleSubmit = async () => {
    const trimmedTitle = form.title.trim();
    if (trimmedTitle.length < 2) {
      Alert.alert("Validation", "Title must be at least 2 characters.");
      return;
    }
    if (!currentOrg || !assetId) return;

    // why: enforce required custom fields BEFORE hitting the server so the
    // user sees a focused message naming the empty fields instead of a
    // generic 400. The server enforces the same contract — see the webapp's
    // mergedSchema validation.
    if (form.customFieldsError) {
      Alert.alert(
        "Custom Fields Unavailable",
        "We couldn't load the custom field definitions. Please retry before saving."
      );
      return;
    }
    // why: `form.customFields` is empty (or stale, mid-category-switch) while
    // defs are loading, so the required-field filter below would silently
    // produce `[]` and let the save through. Belt-and-suspenders with the
    // `canSubmit` disable on the button: the button is disabled, but if the
    // user somehow triggers submit anyway (rapid double-tap before the
    // disable lands), this guard still catches it. Mirrors `new.tsx`.
    if (form.isCustomFieldsLoading) {
      Alert.alert(
        "Please wait",
        "Custom fields are still loading. Try again in a moment."
      );
      return;
    }
    const missingRequired = form.customFields
      .filter((cf) => cf.required && !cf.value.trim())
      .map((cf) => cf.name);
    if (missingRequired.length > 0) {
      Alert.alert(
        "Missing required fields",
        `Please fill in: ${missingRequired.join(", ")}.`
      );
      return;
    }

    form.setIsSubmitting(true);

    // Build payload with only changed fields
    const payload: Record<string, any> = { assetId };

    if (trimmedTitle !== form.originalAsset?.title) {
      payload.title = trimmedTitle;
    }
    if (form.description.trim() !== (form.originalAsset?.description || "")) {
      payload.description = form.description.trim();
    }

    // Category: send "uncategorized" to clear, or the ID to set
    const origCatId = form.originalAsset?.category?.id || null;
    const newCatId = form.selectedCategory?.id || null;
    if (newCatId !== origCatId) {
      payload.categoryId = newCatId || "uncategorized";
    }

    // Location: send the new and current IDs so the server can detect changes
    const origLocId = form.originalAsset?.location?.id || null;
    const newLocId = form.selectedLocation?.id || null;
    if (newLocId !== origLocId) {
      payload.newLocationId = newLocId || "";
      payload.currentLocationId = origLocId || "";
    }

    // Valuation
    const numVal = form.valuation.trim()
      ? parseFloat(form.valuation.trim())
      : null;
    const origVal = form.originalAsset?.valuation ?? null;
    if (numVal !== origVal) {
      payload.valuation = numVal;
    }

    // Custom fields — include all changed fields
    const changedCustomFields = form.customFields
      .filter((cf) => cf.value !== cf.originalValue)
      .map((cf) => ({
        id: cf.id,
        value: buildCustomFieldPayloadValue(cf.type, cf.value),
      }));
    if (changedCustomFields.length > 0) {
      payload.customFields = changedCustomFields;
    }

    // Check if anything actually changed
    const hasChanges = Object.keys(payload).length > 1; // > 1 because assetId is always there
    if (!hasChanges) {
      Alert.alert("No Changes", "Nothing was modified.");
      form.setIsSubmitting(false);
      return;
    }

    const { data, error } = await api.updateAsset(
      currentOrg.id,
      payload as any
    );
    form.setIsSubmitting(false);

    if (error || !data) {
      Alert.alert("Error", error || "Failed to update asset.");
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Updated", `"${data.asset.title}" has been updated.`, [
      {
        text: "OK",
        onPress: () => router.back(),
      },
    ]);
  };

  const canSubmit =
    form.title.trim().length >= 2 &&
    !form.isSubmitting &&
    !form.isCustomFieldsLoading &&
    !form.customFieldsError;

  // ── Loading state ───────────────────────────────
  if (form.isLoadingAsset) {
    return (
      <>
        <Stack.Screen options={{ title: "Edit Asset" }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.muted} />
        </View>
      </>
    );
  }

  if (form.loadError || !form.originalAsset) {
    return (
      <>
        <Stack.Screen options={{ title: "Error" }} />
        <View style={styles.centered}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={colors.error}
          />
          <Text style={styles.errorText}>
            {form.loadError || "Asset not found"}
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => router.back()}
            accessibilityLabel="Go back and try again"
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: `Edit: ${form.originalAsset.title}` }} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={100}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Title (required) ─────────────────────── */}
          <View style={styles.field}>
            <Text style={styles.label}>
              Title <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={form.title}
              onChangeText={form.setTitle}
              placeholder="Asset title"
              placeholderTextColor={colors.placeholderText}
              returnKeyType="next"
              maxLength={100}
              accessibilityLabel={labelForRequired("Title")}
            />
            {form.title.length > 0 && form.title.trim().length < 2 && (
              <Text
                style={styles.errorHint}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                Must be at least 2 characters
              </Text>
            )}
          </View>

          {/* ── Description ────────────────────────────── */}
          <View style={styles.field}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={form.description}
              onChangeText={form.setDescription}
              placeholder="Optional description..."
              placeholderTextColor={colors.placeholderText}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              maxLength={1000}
              accessibilityLabel="Description"
            />
          </View>

          {/* ── Category Picker ──────────────────────── */}
          <PickerField
            label="Category"
            items={form.categories}
            selectedId={form.selectedCategory?.id ?? null}
            onSelect={(cat) => form.setSelectedCategory(cat)}
            onClear={() => form.setSelectedCategory(null)}
            isLoading={form.isCategoriesLoading}
            searchPlaceholder="Search categories..."
            renderItemIcon={(cat) => (
              <View
                style={[
                  styles.categoryDot,
                  { backgroundColor: cat.color || colors.muted },
                ]}
              />
            )}
            renderSelected={(cat) => (
              <>
                <View
                  style={[
                    styles.categoryDot,
                    { backgroundColor: cat.color || colors.muted },
                  ]}
                />
              </>
            )}
          />

          {/* ── Location Picker ──────────────────────── */}
          {form.originalAsset.kit ? (
            <View style={styles.field}>
              <Text style={styles.label}>Location</Text>
              <View style={styles.kitWarning}>
                <Ionicons
                  name="information-circle-outline"
                  size={16}
                  color={colors.muted}
                />
                <Text style={styles.kitWarningText}>
                  Location is managed by kit &quot;
                  {form.originalAsset.kit.name}
                  &quot;
                </Text>
              </View>
            </View>
          ) : (
            <PickerField
              label="Location"
              items={form.locations}
              selectedId={form.selectedLocation?.id ?? null}
              onSelect={(loc) => form.setSelectedLocation(loc)}
              onClear={() => form.setSelectedLocation(null)}
              isLoading={form.isLocationsLoading}
              searchPlaceholder="Search locations..."
              renderItemIcon={() => (
                <Ionicons
                  name="location-outline"
                  size={16}
                  color={colors.muted}
                />
              )}
              renderSelected={() => (
                <Ionicons
                  name="location-outline"
                  size={16}
                  color={colors.iconDefault}
                />
              )}
            />
          )}

          {/* ── Valuation ──────────────────────────────── */}
          <ValuationField
            value={form.valuation}
            onChange={form.setValuation}
            currency={form.originalAsset.organization?.currency || "USD"}
          />

          {/* ── Custom Fields ──────────────────────────── */}
          {(form.customFields.length > 0 ||
            form.isCustomFieldsLoading ||
            form.customFieldsError) && (
            <View style={styles.customFieldsSection}>
              <Text style={styles.sectionLabel}>Custom Fields</Text>
              {form.isCustomFieldsLoading && form.customFields.length === 0 ? (
                <Text style={styles.helpText}>Loading custom fields…</Text>
              ) : form.customFieldsError ? (
                <View>
                  <Text style={styles.helpText}>{form.customFieldsError}</Text>
                  <TouchableOpacity
                    onPress={form.retryLoadCustomFields}
                    accessibilityRole="button"
                  >
                    <Text style={styles.retryLink}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                form.customFields.map((cf) => (
                  <View key={cf.id} style={styles.field}>
                    <Text style={styles.label}>
                      {cf.name}
                      {cf.required ? (
                        <Text style={styles.required}> *</Text>
                      ) : null}
                      {cf.helpText ? (
                        <Text style={styles.helpText}> — {cf.helpText}</Text>
                      ) : null}
                    </Text>
                    <CustomFieldInput
                      field={cf}
                      value={cf.value}
                      onChange={(val) => form.updateCustomField(cf.id, val)}
                    />
                  </View>
                ))
              )}
            </View>
          )}
        </ScrollView>

        {/* ── Bottom action bar ──────────────────────── */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.cancelButton}
            accessibilityLabel="Cancel editing"
            accessibilityRole="button"
            onPress={() => {
              if (isDirty) {
                Alert.alert(
                  "Discard Changes?",
                  "You have unsaved changes. Are you sure you want to go back?",
                  [
                    { text: "Keep Editing", style: "cancel" },
                    {
                      text: "Discard",
                      style: "destructive",
                      onPress: () => router.back(),
                    },
                  ]
                );
              } else {
                router.back();
              }
            }}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.submitButton,
              !canSubmit && styles.submitButtonDisabled,
            ]}
            disabled={!canSubmit}
            onPress={handleSubmit}
            accessibilityLabel={
              form.isSubmitting ? "Saving changes" : "Save changes"
            }
            accessibilityRole="button"
          >
            {form.isSubmitting ? (
              <ActivityIndicator
                color={colors.primaryForeground}
                size="small"
              />
            ) : (
              <>
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={colors.primaryForeground}
                />
                <Text style={styles.submitButtonText}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 10,
    borderRadius: borderRadius.lg,
    marginTop: spacing.sm,
  },
  retryText: {
    color: colors.primaryForeground,
    fontWeight: "600",
    fontSize: fontSize.base,
  },
  errorText: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: spacing.xxxl,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 120,
  },

  // ── Field ─────────────────────────────────────
  field: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  required: {
    color: colors.error,
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: fontSize.lg,
    color: colors.foreground,
    ...shadows.sm,
  },
  textArea: {
    minHeight: 80,
    paddingTop: 12,
  },
  errorHint: {
    fontSize: fontSize.sm,
    color: colors.error,
    marginTop: 4,
  },

  // ── Kit warning ───────────────────────────────
  kitWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.backgroundTertiary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kitWarningText: {
    flex: 1,
    fontSize: fontSize.base,
    color: colors.muted,
    fontStyle: "italic",
  },

  // ── Category dot (used by picker renderItemIcon) ──
  categoryDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  // ── Bottom bar ────────────────────────────────
  bottomBar: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingBottom: spacing.xxxl,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
    ...shadows.lg,
  },
  cancelButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.gray300,
    backgroundColor: colors.white,
  },
  cancelButtonText: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  submitButton: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: colors.primaryForeground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },

  // ── Custom fields ──────────────────────────
  customFieldsSection: {
    marginTop: spacing.md,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  helpText: {
    fontWeight: "400",
    color: colors.mutedLight,
    fontSize: fontSize.sm,
  },
  retryLink: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: "500",
    marginTop: spacing.xs,
  },
}));
