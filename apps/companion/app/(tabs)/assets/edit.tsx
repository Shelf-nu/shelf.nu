import { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from "react-native";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { useNavigation } from "@react-navigation/native";
import { usePreventRemove } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { api, type AssetDetail, type Category, type Location } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { labelForRequired } from "@/lib/a11y";

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

/** Build the JSON value payload for a custom field update */
function buildCustomFieldPayloadValue(type: string, value: string): any {
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
    default:
      return { raw: value };
  }
}

export default function EditAssetScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { id: assetId } = useLocalSearchParams<{ id: string }>();
  const { currentOrg } = useOrg();
  const { colors } = useTheme();
  const styles = useStyles();

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
  type CustomFieldState = {
    id: string; // customField.id
    name: string;
    type: string;
    helpText: string | null;
    value: string; // string representation for editing
    originalValue: string;
  };
  const [customFields, setCustomFields] = useState<CustomFieldState[]>([]);

  // ── Picker data ─────────────────────────────────
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [isCategoriesLoading, setIsCategoriesLoading] = useState(false);
  const [isLocationsLoading, setIsLocationsLoading] = useState(false);

  // ── Picker visibility ───────────────────────────
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [locationSearch, setLocationSearch] = useState("");

  // ── Load existing asset ─────────────────────────
  useEffect(() => {
    if (!assetId) return;
    setIsLoadingAsset(true);
    api.asset(assetId).then(({ data, error }) => {
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
                type: cf.customField.type,
                helpText: cf.customField.helpText,
                value: rawVal,
                originalValue: rawVal,
              };
            });
          setCustomFields(cfStates);
        }
      }
      setIsLoadingAsset(false);
    });
  }, [assetId]);

  // ── Load categories & locations ─────────────────
  const loadCategories = useCallback(async () => {
    if (!currentOrg) return;
    setIsCategoriesLoading(true);
    const { data } = await api.categories(currentOrg.id);
    if (data?.categories) setCategories(data.categories);
    setIsCategoriesLoading(false);
  }, [currentOrg]);

  const loadLocations = useCallback(async () => {
    if (!currentOrg) return;
    setIsLocationsLoading(true);
    const { data } = await api.locations(currentOrg.id);
    if (data?.locations) setLocations(data.locations);
    setIsLocationsLoading(false);
  }, [currentOrg]);

  useEffect(() => {
    loadCategories();
    loadLocations();
  }, [loadCategories, loadLocations]);

  // ── Filtered picker lists ───────────────────────
  const filteredCategories = categorySearch
    ? categories.filter((c) =>
        c.name.toLowerCase().includes(categorySearch.toLowerCase())
      )
    : categories;

  const filteredLocations = locationSearch
    ? locations.filter((l) =>
        l.name.toLowerCase().includes(locationSearch.toLowerCase())
      )
    : locations;

  // ── Custom field helpers ────────────────────────
  const updateCustomField = (cfId: string, newValue: string) => {
    setCustomFields((prev) =>
      prev.map((cf) => (cf.id === cfId ? { ...cf, value: newValue } : cf))
    );
  };

  const renderCustomFieldInput = (cf: CustomFieldState) => {
    switch (cf.type) {
      case "BOOLEAN":
        return (
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>
              {cf.value === "true" ? "Yes" : "No"}
            </Text>
            <Switch
              value={cf.value === "true"}
              onValueChange={(val) =>
                updateCustomField(cf.id, val ? "true" : "false")
              }
              trackColor={{ true: colors.primary, false: colors.gray300 }}
              thumbColor={colors.white}
              accessibilityLabel={`${cf.name}: ${
                cf.value === "true" ? "Yes" : "No"
              }`}
            />
          </View>
        );
      case "MULTILINE_TEXT":
        return (
          <TextInput
            style={[styles.input, styles.textArea]}
            value={cf.value}
            onChangeText={(val) => updateCustomField(cf.id, val)}
            placeholder={`Enter ${cf.name.toLowerCase()}...`}
            placeholderTextColor={colors.placeholderText}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            accessibilityLabel={cf.name}
          />
        );
      case "DATE":
        return (
          <TextInput
            style={styles.input}
            value={cf.value}
            onChangeText={(val) => updateCustomField(cf.id, val)}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.placeholderText}
            accessibilityLabel={cf.name}
          />
        );
      case "AMOUNT":
      case "NUMBER":
        return (
          <TextInput
            style={styles.input}
            value={cf.value}
            onChangeText={(val) => {
              const cleaned = val.replace(/[^0-9.-]/g, "");
              updateCustomField(cf.id, cleaned);
            }}
            placeholder="0"
            placeholderTextColor={colors.placeholderText}
            keyboardType="decimal-pad"
            accessibilityLabel={cf.name}
          />
        );
      default: // TEXT, OPTION, etc.
        return (
          <TextInput
            style={styles.input}
            value={cf.value}
            onChangeText={(val) => updateCustomField(cf.id, val)}
            placeholder={`Enter ${cf.name.toLowerCase()}...`}
            placeholderTextColor={colors.placeholderText}
            accessibilityLabel={cf.name}
          />
        );
    }
  };

  // ── Submit ──────────────────────────────────────
  const handleSubmit = async () => {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 2) {
      Alert.alert("Validation", "Title must be at least 2 characters.");
      return;
    }
    if (!currentOrg || !assetId) return;

    setIsSubmitting(true);

    // Build payload with only changed fields
    const payload: Record<string, any> = { assetId };

    if (trimmedTitle !== originalAsset?.title) {
      payload.title = trimmedTitle;
    }
    if (description.trim() !== (originalAsset?.description || "")) {
      payload.description = description.trim();
    }

    // Category: send "uncategorized" to clear, or the ID to set
    const origCatId = originalAsset?.category?.id || null;
    const newCatId = selectedCategory?.id || null;
    if (newCatId !== origCatId) {
      payload.categoryId = newCatId || "uncategorized";
    }

    // Location: send the new and current IDs so the server can detect changes
    const origLocId = originalAsset?.location?.id || null;
    const newLocId = selectedLocation?.id || null;
    if (newLocId !== origLocId) {
      payload.newLocationId = newLocId || "";
      payload.currentLocationId = origLocId || "";
    }

    // Valuation
    const numVal = valuation.trim() ? parseFloat(valuation.trim()) : null;
    const origVal = originalAsset?.valuation ?? null;
    if (numVal !== origVal) {
      payload.valuation = numVal;
    }

    // Custom fields — include all changed fields
    const changedCustomFields = customFields
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
      setIsSubmitting(false);
      return;
    }

    const { data, error } = await api.updateAsset(
      currentOrg.id,
      payload as any
    );
    setIsSubmitting(false);

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

  const canSubmit = title.trim().length >= 2 && !isSubmitting;

  // ── Dirty state detection ─────────────────────────
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

  // ── Loading state ───────────────────────────────
  if (isLoadingAsset) {
    return (
      <>
        <Stack.Screen options={{ title: "Edit Asset" }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.muted} />
        </View>
      </>
    );
  }

  if (loadError || !originalAsset) {
    return (
      <>
        <Stack.Screen options={{ title: "Error" }} />
        <View style={styles.centered}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={colors.error}
          />
          <Text style={styles.errorText}>{loadError || "Asset not found"}</Text>
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
      <Stack.Screen options={{ title: `Edit: ${originalAsset.title}` }} />
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
              value={title}
              onChangeText={setTitle}
              placeholder="Asset title"
              placeholderTextColor={colors.placeholderText}
              returnKeyType="next"
              maxLength={100}
              accessibilityLabel={labelForRequired("Title")}
            />
            {title.length > 0 && title.trim().length < 2 && (
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
              value={description}
              onChangeText={setDescription}
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
          <View style={styles.field}>
            <Text style={styles.label}>Category</Text>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => {
                setShowCategoryPicker(!showCategoryPicker);
                setShowLocationPicker(false);
              }}
              accessibilityLabel={
                selectedCategory
                  ? `Category: ${selectedCategory.name}, tap to change`
                  : "Select a category"
              }
              accessibilityRole="button"
            >
              {selectedCategory ? (
                <View style={styles.pickerSelected}>
                  <View
                    style={[
                      styles.categoryDot,
                      {
                        backgroundColor: selectedCategory.color || colors.muted,
                      },
                    ]}
                  />
                  <Text style={styles.pickerSelectedText}>
                    {selectedCategory.name}
                  </Text>
                </View>
              ) : (
                <Text style={styles.pickerPlaceholder}>No category</Text>
              )}
              <Ionicons
                name={showCategoryPicker ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.mutedLight}
              />
            </TouchableOpacity>

            {showCategoryPicker && (
              <View style={styles.pickerDropdown}>
                {categories.length > 5 && (
                  <TextInput
                    style={styles.pickerSearch}
                    value={categorySearch}
                    onChangeText={setCategorySearch}
                    placeholder="Search categories..."
                    placeholderTextColor={colors.placeholderText}
                    accessibilityLabel="Search categories"
                  />
                )}
                {isCategoriesLoading ? (
                  <ActivityIndicator
                    style={styles.pickerLoading}
                    color={colors.muted}
                  />
                ) : filteredCategories.length === 0 ? (
                  <Text style={styles.pickerEmpty}>No categories found</Text>
                ) : (
                  <ScrollView
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                  >
                    {filteredCategories.map((cat) => (
                      <TouchableOpacity
                        key={cat.id}
                        style={[
                          styles.pickerItem,
                          selectedCategory?.id === cat.id &&
                            styles.pickerItemSelected,
                        ]}
                        onPress={() => {
                          setSelectedCategory(
                            selectedCategory?.id === cat.id ? null : cat
                          );
                          setShowCategoryPicker(false);
                          setCategorySearch("");
                        }}
                      >
                        <View
                          style={[
                            styles.categoryDot,
                            { backgroundColor: cat.color || colors.muted },
                          ]}
                        />
                        <Text style={styles.pickerItemText}>{cat.name}</Text>
                        {selectedCategory?.id === cat.id && (
                          <Ionicons
                            name="checkmark"
                            size={18}
                            color={colors.iconActive}
                          />
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
                {selectedCategory && (
                  <TouchableOpacity
                    style={styles.pickerClear}
                    onPress={() => {
                      setSelectedCategory(null);
                      setShowCategoryPicker(false);
                      setCategorySearch("");
                    }}
                  >
                    <Text style={styles.pickerClearText}>Clear category</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* ── Location Picker ──────────────────────── */}
          <View style={styles.field}>
            <Text style={styles.label}>Location</Text>
            {originalAsset.kit ? (
              <View style={styles.kitWarning}>
                <Ionicons
                  name="information-circle-outline"
                  size={16}
                  color={colors.muted}
                />
                <Text style={styles.kitWarningText}>
                  Location is managed by kit &quot;{originalAsset.kit.name}
                  &quot;
                </Text>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.pickerButton}
                  onPress={() => {
                    setShowLocationPicker(!showLocationPicker);
                    setShowCategoryPicker(false);
                  }}
                  accessibilityLabel={
                    selectedLocation
                      ? `Location: ${selectedLocation.name}, tap to change`
                      : "Select a location"
                  }
                  accessibilityRole="button"
                >
                  {selectedLocation ? (
                    <View style={styles.pickerSelected}>
                      <Ionicons
                        name="location-outline"
                        size={16}
                        color={colors.iconDefault}
                      />
                      <Text style={styles.pickerSelectedText}>
                        {selectedLocation.name}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.pickerPlaceholder}>No location</Text>
                  )}
                  <Ionicons
                    name={showLocationPicker ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={colors.mutedLight}
                  />
                </TouchableOpacity>

                {showLocationPicker && (
                  <View style={styles.pickerDropdown}>
                    {locations.length > 5 && (
                      <TextInput
                        style={styles.pickerSearch}
                        value={locationSearch}
                        onChangeText={setLocationSearch}
                        placeholder="Search locations..."
                        placeholderTextColor={colors.placeholderText}
                        accessibilityLabel="Search locations"
                      />
                    )}
                    {isLocationsLoading ? (
                      <ActivityIndicator
                        style={styles.pickerLoading}
                        color={colors.muted}
                      />
                    ) : filteredLocations.length === 0 ? (
                      <Text style={styles.pickerEmpty}>No locations found</Text>
                    ) : (
                      <ScrollView
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                      >
                        {filteredLocations.map((loc) => (
                          <TouchableOpacity
                            key={loc.id}
                            style={[
                              styles.pickerItem,
                              selectedLocation?.id === loc.id &&
                                styles.pickerItemSelected,
                            ]}
                            onPress={() => {
                              setSelectedLocation(
                                selectedLocation?.id === loc.id ? null : loc
                              );
                              setShowLocationPicker(false);
                              setLocationSearch("");
                            }}
                          >
                            <Ionicons
                              name="location-outline"
                              size={16}
                              color={colors.muted}
                            />
                            <Text style={styles.pickerItemText}>
                              {loc.name}
                            </Text>
                            {selectedLocation?.id === loc.id && (
                              <Ionicons
                                name="checkmark"
                                size={18}
                                color={colors.iconActive}
                              />
                            )}
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                    {selectedLocation && (
                      <TouchableOpacity
                        style={styles.pickerClear}
                        onPress={() => {
                          setSelectedLocation(null);
                          setShowLocationPicker(false);
                          setLocationSearch("");
                        }}
                      >
                        <Text style={styles.pickerClearText}>
                          Clear location
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </>
            )}
          </View>

          {/* ── Valuation ──────────────────────────────── */}
          <View style={styles.field}>
            <Text style={styles.label}>Value</Text>
            <View style={styles.valuationRow}>
              <Text style={styles.currencyLabel}>
                {originalAsset.organization?.currency || "USD"}
              </Text>
              <TextInput
                style={[styles.input, styles.valuationInput]}
                value={valuation}
                onChangeText={(text) => {
                  // Allow only numbers and one decimal point
                  const cleaned = text.replace(/[^0-9.]/g, "");
                  const parts = cleaned.split(".");
                  if (parts.length > 2) return;
                  setValuation(cleaned);
                }}
                placeholder="0.00"
                placeholderTextColor={colors.placeholderText}
                keyboardType="decimal-pad"
                returnKeyType="done"
                accessibilityLabel={`Value in ${
                  originalAsset.organization?.currency || "USD"
                }`}
              />
            </View>
          </View>

          {/* ── Custom Fields ──────────────────────────── */}
          {customFields.length > 0 && (
            <View style={styles.customFieldsSection}>
              <Text style={styles.sectionLabel}>Custom Fields</Text>
              {customFields.map((cf) => (
                <View key={cf.id} style={styles.field}>
                  <Text style={styles.label}>
                    {cf.name}
                    {cf.helpText ? (
                      <Text style={styles.helpText}> — {cf.helpText}</Text>
                    ) : null}
                  </Text>
                  {renderCustomFieldInput(cf)}
                </View>
              ))}
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
              isSubmitting ? "Saving changes" : "Save changes"
            }
            accessibilityRole="button"
          >
            {isSubmitting ? (
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

  // ── Valuation ─────────────────────────────────
  valuationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  currencyLabel: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.muted,
    minWidth: 40,
  },
  valuationInput: {
    flex: 1,
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

  // ── Picker ────────────────────────────────────
  pickerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...shadows.sm,
  },
  pickerPlaceholder: {
    fontSize: fontSize.lg,
    color: colors.mutedLight,
  },
  pickerSelected: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pickerSelectedText: {
    fontSize: fontSize.lg,
    color: colors.foreground,
    fontWeight: "500",
  },
  pickerDropdown: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    marginTop: spacing.xs,
    maxHeight: 220,
    ...shadows.md,
  },
  pickerSearch: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: fontSize.base,
    color: colors.foreground,
  },
  pickerLoading: {
    padding: spacing.lg,
  },
  pickerEmpty: {
    padding: spacing.lg,
    textAlign: "center",
    color: colors.mutedLight,
    fontSize: fontSize.base,
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  pickerItemSelected: {
    backgroundColor: colors.backgroundTertiary,
  },
  pickerItemText: {
    flex: 1,
    fontSize: fontSize.base,
    color: colors.foreground,
  },
  pickerClear: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: "center",
  },
  pickerClearText: {
    fontSize: fontSize.sm,
    color: colors.error,
    fontWeight: "500",
  },
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
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...shadows.sm,
  },
  switchLabel: {
    fontSize: fontSize.lg,
    color: colors.foreground,
  },
}));
