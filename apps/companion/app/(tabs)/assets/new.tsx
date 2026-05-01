import { useState, useEffect, useCallback, useRef } from "react";
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
  ActionSheetIOS,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { api, type Category, type Location } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { labelForRequired } from "@/lib/a11y";

// expo-image-picker requires native module — lazy-loaded to avoid crash
// if the dev client hasn't been rebuilt yet
let ImagePicker: typeof import("expo-image-picker") | null = null;
try {
  // why: dynamic require so dev clients without the native module rebuilt fall back
  // gracefully instead of crashing at JS evaluation time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ImagePicker = require("expo-image-picker");
} catch {
  console.warn(
    "[CreateAsset] expo-image-picker native module not available. Rebuild dev client."
  );
}

export default function CreateAssetScreen() {
  const router = useRouter();
  const { currentOrg } = useOrg();
  const { colors } = useTheme();
  const styles = useStyles();

  // ── Form state ──────────────────────────────────
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(
    null
  );
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Image state ───────────────────────────────
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState("image/jpeg");

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

  // ── Load categories ─────────────────────────────
  const loadCategories = useCallback(async () => {
    if (!currentOrg) return;
    setIsCategoriesLoading(true);
    const { data } = await api.categories(currentOrg.id);
    if (data?.categories) {
      setCategories(data.categories);
    }
    setIsCategoriesLoading(false);
  }, [currentOrg]);

  // ── Load locations ──────────────────────────────
  const loadLocations = useCallback(async () => {
    if (!currentOrg) return;
    setIsLocationsLoading(true);
    const { data } = await api.locations(currentOrg.id);
    if (data?.locations) {
      setLocations(data.locations);
    }
    setIsLocationsLoading(false);
  }, [currentOrg]);

  useEffect(() => {
    loadCategories();
    loadLocations();
  }, [loadCategories, loadLocations]);

  // ── Unsaved changes guard ─────────────────────
  // Track whether the form was submitted successfully (skip guard on success)
  const didSubmitRef = useRef(false);
  const navigation = useNavigation();
  const hasUnsavedChanges =
    title.trim().length > 0 ||
    description.trim().length > 0 ||
    !!selectedCategory ||
    !!selectedLocation ||
    !!imageUri;

  useEffect(() => {
    if (!hasUnsavedChanges || didSubmitRef.current) return;

    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      // If nothing changed or already submitted, allow navigation
      if (!hasUnsavedChanges || didSubmitRef.current) return;

      e.preventDefault();
      Alert.alert(
        "Discard changes?",
        "You have unsaved changes. Are you sure you want to leave?",
        [
          { text: "Keep Editing", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => navigation.dispatch(e.data.action),
          },
        ]
      );
    });

    return unsubscribe;
  }, [navigation, hasUnsavedChanges]);

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

  // ── Image Picker ───────────────────────────────
  const pickImage = async (source: "camera" | "library") => {
    if (!ImagePicker) {
      Alert.alert(
        "Rebuild Required",
        "Image picker requires a rebuilt dev client. Run: npx expo run:ios"
      );
      return;
    }

    if (source === "camera") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Camera access is required to take photos."
        );
        return;
      }
    } else {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Photo library access is required to select images."
        );
        return;
      }
    }

    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.8,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.8,
          });

    if (result.canceled || !result.assets?.[0]) return;

    const picked = result.assets[0];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setImageUri(picked.uri);
    setImageMimeType(picked.mimeType || "image/jpeg");
  };

  const handleImagePress = () => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Take Photo", "Choose from Library"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) pickImage("camera");
          else if (buttonIndex === 2) pickImage("library");
        }
      );
    } else {
      Alert.alert("Add Photo", "Choose a source", [
        { text: "Cancel", style: "cancel" },
        { text: "Take Photo", onPress: () => pickImage("camera") },
        { text: "Choose from Library", onPress: () => pickImage("library") },
      ]);
    }
  };

  // ── Submit ──────────────────────────────────────
  const handleSubmit = async () => {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 2) {
      Alert.alert("Validation", "Title must be at least 2 characters.");
      return;
    }
    if (!currentOrg) return;

    setIsSubmitting(true);
    const { data, error } = await api.createAsset(currentOrg.id, {
      title: trimmedTitle,
      description: description.trim() || undefined,
      categoryId: selectedCategory?.id,
      locationId: selectedLocation?.id,
    });

    setIsSubmitting(false);

    if (error || !data) {
      Alert.alert("Error", error || "Failed to create asset.");
      return;
    }

    // Mark as submitted so the unsaved changes guard doesn't fire
    didSubmitRef.current = true;

    // Haptic feedback on success
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const assetId = data.asset.id;

    // Fire image upload in the background (performance-first)
    if (imageUri) {
      api
        .updateImage(currentOrg.id, assetId, imageUri, imageMimeType)
        .then(({ error: uploadErr }) => {
          if (uploadErr) {
            Alert.alert(
              "Image Upload Failed",
              "The asset was created but the image couldn't be uploaded. You can add it from the asset detail screen."
            );
          }
        });
    }

    // Navigate to the newly created asset
    Alert.alert("Success", `"${data.asset.title}" created!`, [
      {
        text: "View Asset",
        onPress: () => router.replace(`/(tabs)/assets/${assetId}`),
      },
      {
        text: "Create Another",
        onPress: () => {
          didSubmitRef.current = false;
          setTitle("");
          setDescription("");
          setSelectedCategory(null);
          setSelectedLocation(null);
          setImageUri(null);
          setImageMimeType("image/jpeg");
        },
      },
    ]);
  };

  const canSubmit = title.trim().length >= 2 && !isSubmitting;

  return (
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
        {/* ── Photo (optional) ─────────────────────── */}
        <TouchableOpacity
          style={styles.imagePicker}
          onPress={handleImagePress}
          activeOpacity={0.7}
          accessibilityLabel={imageUri ? "Change photo" : "Add a photo"}
          accessibilityRole="button"
        >
          {imageUri ? (
            <View style={styles.imagePreviewContainer}>
              <Image
                source={{ uri: imageUri }}
                style={styles.imagePreview}
                contentFit="cover"
              />
              <View style={styles.imageOverlay}>
                <Ionicons name="camera-outline" size={16} color="#fff" />
                <Text style={styles.imageOverlayText}>Change Photo</Text>
              </View>
            </View>
          ) : (
            <View style={styles.imagePlaceholder}>
              <Ionicons
                name="camera-outline"
                size={32}
                color={colors.mutedLight}
              />
              <Text style={styles.imagePlaceholderText}>Add Photo</Text>
              <Text style={styles.imagePlaceholderHint}>Optional</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* ── Title (required) ─────────────────────── */}
        <View style={styles.field}>
          <Text style={styles.label}>
            Title <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. MacBook Pro 14″"
            placeholderTextColor={colors.placeholderText}
            autoFocus
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

        {/* ── Description (optional) ───────────────── */}
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
            maxLength={500}
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
              <Text style={styles.pickerPlaceholder}>Select a category...</Text>
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
                  <Text style={styles.pickerClearText}>Clear selection</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* ── Location Picker ──────────────────────── */}
        <View style={styles.field}>
          <Text style={styles.label}>Location</Text>
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
              <Text style={styles.pickerPlaceholder}>Select a location...</Text>
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
                      <Text style={styles.pickerItemText}>{loc.name}</Text>
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
                  <Text style={styles.pickerClearText}>Clear selection</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Bottom action bar ──────────────────────── */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[
            styles.submitButton,
            !canSubmit && styles.submitButtonDisabled,
          ]}
          disabled={!canSubmit}
          onPress={handleSubmit}
          accessibilityLabel={isSubmitting ? "Creating asset" : "Create asset"}
          accessibilityRole="button"
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.primaryForeground} size="small" />
          ) : (
            <>
              <Ionicons
                name="add-circle"
                size={20}
                color={colors.primaryForeground}
              />
              <Text style={styles.submitButtonText}>Create Asset</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 120,
  },

  // ── Image picker ─────────────────────────────
  imagePicker: {
    marginBottom: spacing.lg,
  },
  imagePlaceholder: {
    height: 160,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.gray300,
    borderRadius: borderRadius.lg,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.backgroundTertiary,
    gap: spacing.xs,
  },
  imagePlaceholderText: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.muted,
  },
  imagePlaceholderHint: {
    fontSize: fontSize.sm,
    color: colors.mutedLight,
  },
  imagePreviewContainer: {
    height: 180,
    borderRadius: borderRadius.lg,
    overflow: "hidden",
    position: "relative",
  },
  imagePreview: {
    width: "100%",
    height: "100%",
  },
  imageOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  imageOverlayText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: "#fff",
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingBottom: spacing.xxxl,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...shadows.lg,
  },
  submitButton: {
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
}));
