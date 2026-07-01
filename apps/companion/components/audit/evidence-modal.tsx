/**
 * Evidence Modal for Audit Scans
 *
 * Allows users to add condition notes and photos to a scanned asset
 * during an audit. Opens as a bottom sheet when tapping a scanned item.
 *
 * @see POST /api/mobile/audits/note - Create text note
 * @see POST /api/mobile/audits/image - Upload photo with optional note
 */

import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ActionSheetIOS,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import type { ScannedItem } from "@/hooks/use-audit-init";

// Lazy-load native image modules below all imports (keeps import/first happy)
// to avoid a crash when the native module isn't present in the current build.
let ImageManipulator: typeof import("expo-image-manipulator") | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ImageManipulator = require("expo-image-manipulator");
} catch {
  // expo-image-manipulator not available
}

let ImagePicker: typeof import("expo-image-picker") | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ImagePicker = require("expo-image-picker");
} catch {
  // expo-image-picker not available
}

/**
 * Converts HEIC/HEIF images to JPEG for server compatibility.
 * iOS captures photos in HEIC format by default, which many servers don't accept.
 */
async function ensureJpegFormat(
  uri: string,
  mimeType: string | null
): Promise<{ uri: string; mimeType: string }> {
  // If already JPEG/PNG/etc, return as-is
  const isHeic =
    mimeType?.includes("heic") ||
    mimeType?.includes("heif") ||
    uri.toLowerCase().endsWith(".heic") ||
    uri.toLowerCase().endsWith(".heif");

  if (!isHeic) {
    return { uri, mimeType: mimeType || "image/jpeg" };
  }

  // If ImageManipulator not available, return as-is and let server handle it
  if (!ImageManipulator) {
    return { uri, mimeType: mimeType || "image/jpeg" };
  }

  // Convert HEIC to JPEG using expo-image-manipulator
  const result = await ImageManipulator.manipulateAsync(uri, [], {
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  return { uri: result.uri, mimeType: "image/jpeg" };
}

type EvidenceModalProps = {
  visible: boolean;
  onClose: () => void;
  item: ScannedItem | null;
  auditSessionId: string;
  /** Callback when evidence is added, to update counts */
  onEvidenceAdded: (assetId: string, type: "note" | "image") => void;
};

export function EvidenceModal({
  visible,
  onClose,
  item,
  auditSessionId,
  onEvidenceAdded,
}: EvidenceModalProps) {
  const { currentOrg } = useOrg();
  const { colors } = useTheme();
  const styles = useStyles();

  const [noteText, setNoteText] = useState("");
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [isSubmittingImage, setIsSubmittingImage] = useState(false);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState("image/jpeg");

  const resetState = useCallback(() => {
    setNoteText("");
    setSelectedImageUri(null);
    setIsSubmittingNote(false);
    setIsSubmittingImage(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const handleSubmitNote = useCallback(async () => {
    if (!item?.auditAssetId || !currentOrg || !noteText.trim()) return;

    setIsSubmittingNote(true);
    try {
      const { error } = await api.createNote(currentOrg.id, {
        auditSessionId,
        auditAssetId: item.auditAssetId,
        content: noteText.trim(),
      });

      if (error) {
        Alert.alert("Error", error);
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onEvidenceAdded(item.assetId, "note");
      setNoteText("");
    } catch {
      Alert.alert("Error", "Failed to save note. Please try again.");
    } finally {
      setIsSubmittingNote(false);
    }
  }, [item, currentOrg, auditSessionId, noteText, onEvidenceAdded]);

  const pickImage = useCallback(async (useCamera: boolean) => {
    if (!ImagePicker) {
      Alert.alert("Error", "Image picker not available");
      return;
    }

    const permissionResult = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      Alert.alert(
        "Permission Required",
        `Please grant ${
          useCamera ? "camera" : "photo library"
        } access to add photos.`
      );
      return;
    }

    const result = useCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 0.8,
          allowsEditing: false,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.8,
          allowsEditing: false,
        });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      // Convert HEIC to JPEG if needed (iOS captures in HEIC by default)
      const { uri, mimeType } = await ensureJpegFormat(
        asset.uri,
        asset.mimeType || null
      );
      setSelectedImageUri(uri);
      setImageMimeType(mimeType);
    }
  }, []);

  const handleImagePress = useCallback(() => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Take Photo", "Choose from Library"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) pickImage(true);
          else if (buttonIndex === 2) pickImage(false);
        }
      );
    } else {
      Alert.alert("Add Photo", "Choose an option", [
        { text: "Cancel", style: "cancel" },
        { text: "Take Photo", onPress: () => pickImage(true) },
        { text: "Choose from Library", onPress: () => pickImage(false) },
      ]);
    }
  }, [pickImage]);

  const handleSubmitImage = useCallback(async () => {
    if (!item?.auditAssetId || !currentOrg || !selectedImageUri) return;

    setIsSubmittingImage(true);
    try {
      const { error } = await api.uploadImage(
        currentOrg.id,
        auditSessionId,
        item.auditAssetId,
        selectedImageUri,
        imageMimeType,
        noteText.trim() || undefined
      );

      if (error) {
        Alert.alert("Error", error);
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onEvidenceAdded(item.assetId, "image");
      // Server also creates a note when text accompanies the image
      if (noteText.trim()) {
        onEvidenceAdded(item.assetId, "note");
      }
      setSelectedImageUri(null);
      setNoteText("");
    } catch {
      Alert.alert("Error", "Failed to upload photo. Please try again.");
    } finally {
      setIsSubmittingImage(false);
    }
  }, [
    item,
    currentOrg,
    auditSessionId,
    selectedImageUri,
    imageMimeType,
    noteText,
    onEvidenceAdded,
  ]);

  if (!item) return null;

  const canSubmitNote = noteText.trim().length > 0 && !isSubmittingNote;
  const canSubmitImage = selectedImageUri && !isSubmittingImage;
  const isSubmitting = isSubmittingNote || isSubmittingImage;

  // If auditAssetId is not yet available (scan still queued), show a message
  const isPending = !item.auditAssetId;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleClose}
        />
        <View style={styles.sheet}>
          {/* Header - fixed at top */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons
                name={item.isExpected ? "checkmark-circle" : "alert-circle"}
                size={20}
                color={item.isExpected ? colors.success : colors.warning}
              />
              <Text style={styles.headerTitle} numberOfLines={1}>
                {item.name}
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={24} color={colors.muted} />
            </TouchableOpacity>
          </View>

          {/* Scrollable content - allows button to remain visible with keyboard */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
          >
            {isPending ? (
              <View style={styles.pendingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.pendingText}>
                  Waiting for scan to sync...
                </Text>
                <Text style={styles.pendingHint}>
                  You can add notes and photos once the scan is confirmed.
                </Text>
              </View>
            ) : (
              <>
                {/* Evidence counts */}
                <View style={styles.countsRow}>
                  <View style={styles.countBadge}>
                    <Ionicons
                      name="document-text-outline"
                      size={14}
                      color={colors.muted}
                    />
                    <Text style={styles.countText}>
                      {item.notesCount ?? 0}{" "}
                      {(item.notesCount ?? 0) === 1 ? "note" : "notes"}
                    </Text>
                  </View>
                  <View style={styles.countBadge}>
                    <Ionicons
                      name="camera-outline"
                      size={14}
                      color={colors.muted}
                    />
                    <Text style={styles.countText}>
                      {item.imagesCount ?? 0}{" "}
                      {(item.imagesCount ?? 0) === 1 ? "photo" : "photos"}
                    </Text>
                  </View>
                </View>

                {/* Image preview / picker */}
                {selectedImageUri ? (
                  <View style={styles.imagePreviewContainer}>
                    <Image
                      key={selectedImageUri}
                      source={{ uri: selectedImageUri }}
                      style={styles.imagePreview}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                    <TouchableOpacity
                      style={styles.removeImageButton}
                      onPress={() => setSelectedImageUri(null)}
                      accessibilityLabel="Remove photo"
                    >
                      <Ionicons name="close-circle" size={28} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.addPhotoButton}
                    onPress={handleImagePress}
                    disabled={isSubmitting}
                    accessibilityLabel="Add photo"
                  >
                    <Ionicons
                      name="camera-outline"
                      size={24}
                      color={colors.primary}
                    />
                    <Text style={styles.addPhotoText}>Add Photo</Text>
                  </TouchableOpacity>
                )}

                {/* Note input */}
                <View style={styles.noteContainer}>
                  <TextInput
                    style={styles.noteInput}
                    placeholder={
                      item.isExpected
                        ? "Add a condition note..."
                        : "Why is this item here?"
                    }
                    placeholderTextColor={colors.muted}
                    value={noteText}
                    onChangeText={setNoteText}
                    multiline
                    maxLength={5000}
                    editable={!isSubmitting}
                    accessibilityLabel={
                      item.isExpected ? "Condition note" : "Explanation note"
                    }
                  />
                </View>

                {/* Submit buttons */}
                <View style={styles.actions}>
                  {selectedImageUri ? (
                    <TouchableOpacity
                      style={[
                        styles.submitButton,
                        !canSubmitImage && styles.submitButtonDisabled,
                      ]}
                      onPress={handleSubmitImage}
                      disabled={!canSubmitImage}
                      accessibilityLabel="Upload photo"
                    >
                      {isSubmittingImage ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons
                            name="cloud-upload-outline"
                            size={18}
                            color="#fff"
                          />
                          <Text style={styles.submitButtonText}>
                            Upload Photo{noteText.trim() ? " + Note" : ""}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.submitButton,
                        !canSubmitNote && styles.submitButtonDisabled,
                      ]}
                      onPress={handleSubmitNote}
                      disabled={!canSubmitNote}
                      accessibilityLabel="Save note"
                    >
                      {isSubmittingNote ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons
                            name="save-outline"
                            size={18}
                            color="#fff"
                          />
                          <Text style={styles.submitButtonText}>Save Note</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...Platform.select({
      ios: { flex: 1 },
      android: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
    }),
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl + 20, // Extra for safe area
    maxHeight: "80%",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.1,
        shadowRadius: 5,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scrollContent: {
    flexGrow: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.foreground,
    flex: 1,
  },
  pendingContainer: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  pendingText: {
    fontSize: fontSize.md,
    fontWeight: "500",
    color: colors.foreground,
  },
  pendingHint: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: "center",
  },
  countsRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  countBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  countText: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  addPhotoButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    marginBottom: spacing.md,
  },
  addPhotoText: {
    fontSize: fontSize.md,
    fontWeight: "500",
    color: colors.primary,
  },
  imagePreviewContainer: {
    position: "relative",
    marginBottom: spacing.md,
  },
  imagePreview: {
    width: "100%",
    height: 200,
    borderRadius: borderRadius.lg,
  },
  removeImageButton: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 14,
  },
  noteContainer: {
    marginBottom: spacing.md,
  },
  noteInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.foreground,
    minHeight: 80,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    gap: spacing.md,
  },
  submitButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
  },
  submitButtonDisabled: {
    backgroundColor: colors.primaryLight || "rgba(239, 104, 32, 0.4)",
  },
  submitButtonText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: "#fff",
  },
}));
