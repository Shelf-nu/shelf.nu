import { useState, useEffect, useCallback, memo } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActionSheetIOS,
  Modal,
  Dimensions,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
// Lazy-loaded: ~50KB library only needed when viewing QR codes on asset detail
let QRCode: typeof import("react-native-qrcode-svg").default | null = null;
try {
  QRCode =
    require("react-native-qrcode-svg").default ??
    require("react-native-qrcode-svg");
} catch {
  // Will render graceful fallback instead of QR code
}
// expo-image-picker requires native module — lazy-loaded to avoid crash
// if the dev client hasn't been rebuilt yet
let ImagePicker: typeof import("expo-image-picker") | null = null;
try {
  ImagePicker = require("expo-image-picker");
} catch {
  console.warn(
    "[AssetDetail] expo-image-picker native module not available. Rebuild dev client."
  );
}
import {
  api,
  type AssetDetail,
  type AssetNote,
  type TeamMember,
  type Location as LocationType,
} from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import {
  fontSize,
  spacing,
  borderRadius,
  formatStatus,
  formatDate,
} from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { TeamMemberPicker } from "@/components/team-member-picker";
import { LocationPicker } from "@/components/location-picker";
import { AssetDetailSkeleton } from "@/components/skeleton-loader";
import { announce } from "@/lib/a11y";

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { currentOrg } = useOrg();
  const { colors, statusBadge } = useTheme();
  const styles = useStyles();
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Action states
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [showCustodyPicker, setShowCustodyPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);

  // Notes
  const [noteText, setNoteText] = useState("");
  const [isPostingNote, setIsPostingNote] = useState(false);

  // Image upload
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Image zoom
  const [showImageZoom, setShowImageZoom] = useState(false);

  const fetchAsset = useCallback(async () => {
    const { data, error: fetchErr } = await api.asset(id);
    // Request cancelled (navigation) — ignore
    if (!data && !fetchErr) return;
    if (fetchErr || !data) {
      setError(fetchErr || "Failed to load asset details");
      setAsset(null);
    } else {
      setAsset(data.asset);
      setError(null);
    }
  }, [id]);

  useEffect(() => {
    setIsLoading(true);
    fetchAsset().finally(() => setIsLoading(false));
  }, [fetchAsset]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await fetchAsset();
    setIsRefreshing(false);
    announce("Content refreshed");
  };

  // ── Custody Actions ─────────────────────────────────

  const handleAssignCustody = (member: TeamMember) => {
    setShowCustodyPicker(false);
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

  const performAssign = async (custodianId: string) => {
    if (!currentOrg || !asset) return;
    setIsActionLoading(true);
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
    setIsActionLoading(false);
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

  const performRelease = async () => {
    if (!currentOrg || !asset) return;
    setIsActionLoading(true);
    const { error: err } = await api.releaseCustody(currentOrg.id, asset.id);
    if (err) Alert.alert("Error", err);
    else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await fetchAsset();
    }
    setIsActionLoading(false);
  };

  // ── Location Action ─────────────────────────────────

  const handleLocationSelect = (location: LocationType) => {
    setShowLocationPicker(false);
    if (location.id === asset?.location?.id) return; // same location

    Alert.alert(
      "Update Location",
      `Move "${asset?.title}" to ${location.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Move", onPress: () => performUpdateLocation(location.id) },
      ]
    );
  };

  const performUpdateLocation = async (locationId: string) => {
    if (!currentOrg || !asset) return;
    setIsActionLoading(true);
    const { error: err } = await api.updateLocation(
      currentOrg.id,
      asset.id,
      locationId
    );
    if (err) Alert.alert("Error", err);
    else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await fetchAsset();
    }
    setIsActionLoading(false);
  };

  // ── Notes Action ────────────────────────────────────

  const handlePostNote = async () => {
    if (!asset || !noteText.trim()) return;
    setIsPostingNote(true);
    const { error: err } = await api.addNote(asset.id, noteText.trim());
    if (err) {
      Alert.alert("Error", err);
    } else {
      setNoteText("");
      await fetchAsset();
    }
    setIsPostingNote(false);
  };

  // ── Image Upload ───────────────────────────────────

  const pickAndUploadImage = async (source: "camera" | "library") => {
    if (!currentOrg || !asset) return;

    if (!ImagePicker) {
      Alert.alert(
        "Rebuild Required",
        "Image picker requires a rebuilt dev client. Run: npx expo run:ios"
      );
      return;
    }

    // Request permissions
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

    const pickedImage = result.assets[0];
    setIsUploadingImage(true);

    const { error: uploadErr } = await api.updateImage(
      currentOrg.id,
      asset.id,
      pickedImage.uri,
      pickedImage.mimeType || "image/jpeg"
    );

    if (uploadErr) {
      Alert.alert("Upload Failed", uploadErr);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await fetchAsset();
    }

    setIsUploadingImage(false);
  };

  const handleImagePress = () => {
    if (isUploadingImage) return;

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Take Photo", "Choose from Library"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) pickAndUploadImage("camera");
          else if (buttonIndex === 2) pickAndUploadImage("library");
        }
      );
    } else {
      Alert.alert("Update Image", "Choose a source", [
        { text: "Cancel", style: "cancel" },
        { text: "Take Photo", onPress: () => pickAndUploadImage("camera") },
        {
          text: "Choose from Library",
          onPress: () => pickAndUploadImage("library"),
        },
      ]);
    }
  };

  // ── Delete Asset ──────────────────────────────────

  const handleDeleteAsset = () => {
    if (!asset) return;
    Alert.alert(
      "Delete Asset",
      `Are you sure you want to permanently delete "${asset.title}"? This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: performDeleteAsset,
        },
      ]
    );
  };

  const performDeleteAsset = async () => {
    if (!currentOrg || !asset) return;
    setIsActionLoading(true);
    const { error: err } = await api.deleteAsset(currentOrg.id, asset.id);
    setIsActionLoading(false);
    if (err) {
      Alert.alert("Error", err);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Deleted", `"${asset.title}" has been deleted.`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    }
  };

  // ── Helpers ─────────────────────────────────────────

  const formatCurrency = (value: number, currency: string) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
      }).format(value);
    } catch {
      return `${currency} ${value.toFixed(2)}`;
    }
  };

  const formatCustomFieldValue = (cf: AssetDetail["customFields"][0]) => {
    const val = cf.value;
    if (val === null || val === undefined) return "—";

    // Handle different custom field types
    switch (cf.customField.type) {
      case "BOOLEAN":
        return val?.raw === true || val?.raw === "true" ? "Yes" : "No";
      case "DATE":
        return val?.raw ? formatDate(String(val.raw)) : "—";
      case "OPTION":
        return val?.valueText || val?.raw || "—";
      case "MULTILINE_TEXT":
        return val?.raw || val?.valueText || "—";
      case "AMOUNT": {
        const amount = val?.raw ?? val?.valueText;
        return amount != null ? String(amount) : "—";
      }
      default:
        return (
          val?.raw ?? val?.valueText ?? (typeof val === "string" ? val : "—")
        );
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return formatDate(dateStr);
  };

  // ── Render ──────────────────────────────────────────

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Loading..." }} />
        <AssetDetailSkeleton />
      </>
    );
  }

  if (error || !asset) {
    return (
      <>
        <Stack.Screen options={{ title: "Error" }} />
        <View style={styles.centered}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={colors.error}
          />
          <Text style={styles.errorText}>{error || "Asset not found"}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setError(null);
              setIsLoading(true);
              fetchAsset().finally(() => setIsLoading(false));
            }}
            accessibilityLabel="Retry loading asset"
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  const badge = statusBadge[asset.status] ?? {
    bg: colors.backgroundTertiary,
    text: colors.muted,
  };
  const hasCustody = !!asset.custody;
  const isAvailable = asset.status === "AVAILABLE";
  const activeCustomFields = asset.customFields.filter(
    (cf) => cf.customField.active !== false
  );

  return (
    <>
      <Stack.Screen options={{ title: asset.title }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              accessibilityLabel="Pull to refresh"
            />
          }
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Hero Image ─────────────────────────────── */}
          <View>
            {asset.mainImage ? (
              <TouchableOpacity
                onPress={() => setShowImageZoom(true)}
                activeOpacity={0.9}
                accessibilityLabel="View full-size image"
                accessibilityRole="imagebutton"
              >
                <Image
                  source={{ uri: asset.mainImage }}
                  style={styles.heroImage}
                  contentFit="cover"
                  accessible={true}
                  accessibilityLabel={"Photo of " + asset.title}
                />
              </TouchableOpacity>
            ) : (
              <View
                style={[styles.heroImage, styles.heroPlaceholder]}
                accessible={true}
                accessibilityRole="image"
                accessibilityLabel={"No image for " + asset.title}
              >
                <Ionicons name="cube-outline" size={64} color={colors.border} />
              </View>
            )}

            {/* Upload overlay while uploading */}
            {isUploadingImage && (
              <View style={styles.heroOverlay}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.heroOverlayText}>Uploading...</Text>
              </View>
            )}

            {/* Update image button */}
            {!isUploadingImage && (
              <TouchableOpacity
                style={styles.heroEditBtn}
                onPress={handleImagePress}
                activeOpacity={0.7}
                accessibilityLabel={
                  asset.mainImage ? "Update asset image" : "Add asset image"
                }
                accessibilityRole="button"
              >
                <Ionicons
                  name="camera-outline"
                  size={16}
                  color={colors.foreground}
                />
                <Text style={styles.heroEditBtnText}>
                  {asset.mainImage ? "Update image" : "Add image"}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Title + Status ─────────────────────────── */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>{asset.title}</Text>
            <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
              <View
                style={[styles.statusDot, { backgroundColor: badge.text }]}
              />
              <Text style={[styles.statusText, { color: badge.text }]}>
                {formatStatus(asset.status)}
              </Text>
            </View>
          </View>

          {asset.description && (
            <Text style={styles.description}>{asset.description}</Text>
          )}

          {/* ── Quick Actions ──────────────────────────── */}
          <View style={styles.actionsSection}>
            {isActionLoading ? (
              <View style={styles.actionLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.actionLoadingText}>Updating...</Text>
              </View>
            ) : (
              <>
                {/* Primary action — custody assign/release (matches web app terminology) */}
                {hasCustody ? (
                  <TouchableOpacity
                    style={styles.primaryActionGreen}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      handleReleaseCustody();
                    }}
                    activeOpacity={0.7}
                    accessibilityLabel="Release custody of asset"
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name="person-remove-outline"
                      size={20}
                      color={colors.primaryForeground}
                    />
                    <Text style={styles.primaryActionText}>
                      Release Custody
                    </Text>
                  </TouchableOpacity>
                ) : isAvailable ? (
                  <TouchableOpacity
                    style={styles.primaryActionBlack}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      setShowCustodyPicker(true);
                    }}
                    activeOpacity={0.7}
                    accessibilityLabel="Assign custody of asset"
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name="person-add-outline"
                      size={20}
                      color={colors.primaryForeground}
                    />
                    <Text style={styles.primaryActionText}>Assign Custody</Text>
                  </TouchableOpacity>
                ) : null}

                {/* Secondary actions row */}
                <View style={styles.secondaryActionsRow}>
                  <TouchableOpacity
                    style={styles.secondaryAction}
                    onPress={() => setShowLocationPicker(true)}
                    activeOpacity={0.7}
                    accessibilityLabel="Update location"
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name="location-outline"
                      size={18}
                      color={colors.foreground}
                    />
                    <Text style={styles.secondaryActionText}>
                      {asset.location ? "Move" : "Location"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.secondaryAction}
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/assets/edit",
                        params: { id: asset.id },
                      })
                    }
                    activeOpacity={0.7}
                    accessibilityLabel="Edit asset"
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name="create-outline"
                      size={18}
                      color={colors.foreground}
                    />
                    <Text style={styles.secondaryActionText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.secondaryAction}
                    onPress={() => {
                      if (Platform.OS === "ios") {
                        ActionSheetIOS.showActionSheetWithOptions(
                          {
                            options: ["Cancel", "Delete Asset"],
                            destructiveButtonIndex: 1,
                            cancelButtonIndex: 0,
                            title: "Asset Actions",
                          },
                          (buttonIndex) => {
                            if (buttonIndex === 1) handleDeleteAsset();
                          }
                        );
                      } else {
                        setShowOverflowMenu(true);
                      }
                    }}
                    activeOpacity={0.7}
                    accessibilityLabel="More actions"
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name="ellipsis-horizontal"
                      size={18}
                      color={colors.muted}
                    />
                    <Text style={styles.secondaryActionTextMuted}>More</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          {/* ── Details Card ───────────────────────────── */}
          <View style={styles.infoSection}>
            {asset.category && (
              <InfoRow
                icon="pricetag-outline"
                label="Category"
                value={asset.category.name}
              />
            )}
            {asset.location && (
              <InfoRow
                icon="location-outline"
                label="Location"
                value={asset.location.name}
              />
            )}
            {asset.kit && (
              <InfoRow
                icon="layers-outline"
                label="Kit"
                value={asset.kit.name}
              />
            )}
            {asset.custody && (
              <>
                <InfoRow
                  icon="person-outline"
                  label="In Custody Of"
                  value={asset.custody.custodian.name}
                />
                {asset.custody.custodian.user?.email && (
                  <InfoRow
                    icon="mail-outline"
                    label="Custodian Email"
                    value={asset.custody.custodian.user.email}
                  />
                )}
                <InfoRow
                  icon="time-outline"
                  label="Custody Since"
                  value={formatDate(asset.custody.createdAt)}
                />
              </>
            )}
            {asset.valuation != null && asset.valuation > 0 && (
              <InfoRow
                icon="cash-outline"
                label="Value"
                value={formatCurrency(
                  asset.valuation,
                  asset.organization?.currency || "USD"
                )}
              />
            )}
            <InfoRow
              icon="calendar-outline"
              label="Created"
              value={formatDate(asset.createdAt)}
            />
            <InfoRow
              icon="refresh-outline"
              label="Updated"
              value={formatDate(asset.updatedAt)}
            />
          </View>

          {/* ── Tags ───────────────────────────────────── */}
          {asset.tags.length > 0 && (
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>Tags</Text>
              <View style={styles.tagsRow}>
                {asset.tags.map((tag) => (
                  <View key={tag.id} style={styles.tag}>
                    <Text style={styles.tagText}>{tag.name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── QR Code ─────────────────────────────────── */}
          {asset.qrCodes.length > 0 && (
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>QR Code</Text>
              <View style={styles.qrCard}>
                {QRCode ? (
                  <QRCode
                    value={`${
                      process.env.EXPO_PUBLIC_QR_BASE_URL ||
                      "https://app.shelf.nu"
                    }/qr/${asset.qrCodes[0].id}`}
                    size={160}
                    backgroundColor={colors.white}
                    color={colors.foreground}
                  />
                ) : (
                  <View
                    style={{
                      width: 160,
                      height: 160,
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <Ionicons
                      name="qr-code-outline"
                      size={64}
                      color={colors.muted}
                    />
                  </View>
                )}
                <Text style={styles.qrIdText} selectable numberOfLines={1}>
                  {asset.qrCodes[0].id}
                </Text>
                {asset.qrCodes.length > 1 && (
                  <Text style={styles.qrExtraText}>
                    +{asset.qrCodes.length - 1} more QR code
                    {asset.qrCodes.length > 2 ? "s" : ""} linked
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* ── Custom Fields ──────────────────────────── */}
          {activeCustomFields.length > 0 && (
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>Custom Fields</Text>
              <View style={styles.customFieldsCard}>
                {activeCustomFields.map((cf) => (
                  <View key={cf.id} style={styles.customFieldRow}>
                    <Text style={styles.customFieldLabel}>
                      {cf.customField.name}
                    </Text>
                    <Text style={styles.customFieldValue} numberOfLines={3}>
                      {formatCustomFieldValue(cf)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── Activity / Notes ───────────────────────── */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>
              Activity{asset.notes?.length ? ` (${asset.notes.length})` : ""}
            </Text>

            {/* Add note input */}
            <View style={styles.noteInputContainer}>
              <TextInput
                style={styles.noteInput}
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Add a note..."
                placeholderTextColor={colors.placeholderText}
                multiline
                maxLength={5000}
                accessibilityLabel="Add a note"
              />
              <TouchableOpacity
                style={[
                  styles.notePostBtn,
                  (!noteText.trim() || isPostingNote) &&
                    styles.notePostBtnDisabled,
                ]}
                onPress={handlePostNote}
                disabled={!noteText.trim() || isPostingNote}
                accessibilityLabel="Post note"
                accessibilityRole="button"
              >
                {isPostingNote ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.primaryForeground}
                  />
                ) : (
                  <Ionicons
                    name="send"
                    size={16}
                    color={colors.primaryForeground}
                  />
                )}
              </TouchableOpacity>
            </View>

            {/* Notes list */}
            {asset.notes && asset.notes.length > 0 ? (
              <View style={styles.notesList}>
                {asset.notes.map((note) => (
                  <NoteItem key={note.id} note={note} timeAgo={timeAgo} />
                ))}
              </View>
            ) : (
              <Text style={styles.emptyNotes}>No activity yet</Text>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Overflow Menu (Android) ───────────────────── */}
      <Modal
        visible={showOverflowMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowOverflowMenu(false)}
      >
        <TouchableOpacity
          style={styles.overflowBackdrop}
          activeOpacity={1}
          onPress={() => setShowOverflowMenu(false)}
        >
          <View style={styles.overflowMenu} accessibilityViewIsModal={true}>
            <TouchableOpacity
              style={styles.overflowItem}
              onPress={() => {
                setShowOverflowMenu(false);
                handleDeleteAsset();
              }}
            >
              <Ionicons name="trash-outline" size={20} color={colors.error} />
              <Text style={styles.overflowItemTextDanger}>Delete Asset</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Image Zoom Modal ──────────────────────────── */}
      {asset.mainImage && (
        <Modal
          visible={showImageZoom}
          transparent
          animationType="fade"
          onRequestClose={() => setShowImageZoom(false)}
        >
          <View style={styles.zoomOverlay} accessibilityViewIsModal={true}>
            <TouchableOpacity
              style={styles.zoomCloseBtn}
              onPress={() => setShowImageZoom(false)}
              accessibilityLabel="Close image viewer"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Image
              source={{ uri: asset.mainImage }}
              style={styles.zoomImage}
              contentFit="contain"
            />
          </View>
        </Modal>
      )}

      {/* ── Modals ────────────────────────────────────── */}
      {currentOrg && (
        <>
          <TeamMemberPicker
            visible={showCustodyPicker}
            orgId={currentOrg.id}
            onSelect={handleAssignCustody}
            onClose={() => setShowCustodyPicker(false)}
          />
          <LocationPicker
            visible={showLocationPicker}
            orgId={currentOrg.id}
            currentLocationId={asset?.location?.id}
            onSelect={handleLocationSelect}
            onClose={() => setShowLocationPicker(false)}
          />
        </>
      )}
    </>
  );
}

// ── Sub-components ─────────────────────────────────────

const InfoRow = memo(function InfoRow({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLabel}>
        <Ionicons name={icon as any} size={16} color={colors.muted} />
        <Text style={styles.infoLabelText}>{label}</Text>
      </View>
      <Text style={styles.infoValue} numberOfLines={2} selectable>
        {value}
      </Text>
    </View>
  );
});

/**
 * Converts Markdoc tag syntax in note content to readable plain text.
 * Handles: {% link text="..." /%}, {% date value="..." /%},
 * {% category_badge name="..." /%}, {% tag name="..." /%},
 * {% booking_status status="..." /%}, {% description ... /%},
 * {% assets_list count=N ... /%}, {% kits_list count=N ... /%},
 * and **bold** markers.
 */
function markdocToPlainText(content: string): string {
  return (
    content
      // {% link to="..." text="Display Text" /%} → Display Text
      .replace(/{%\s*link\s+[^%]*?text="([^"]*)"[^%]*\/%}/g, "$1")
      // {% date value="2024-01-01T..." /%} → formatted date
      .replace(
        /{%\s*date\s+value="([^"]*)"[^%]*\/%}/g,
        (_match, iso: string) => {
          try {
            return new Date(iso).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            });
          } catch {
            return iso;
          }
        }
      )
      // {% category_badge name="..." ... /%} → name
      .replace(/{%\s*category_badge\s+name="([^"]*)"[^%]*\/%}/g, "$1")
      // {% tag name="..." ... /%} → name
      .replace(/{%\s*tag\s+name="([^"]*)"[^%]*\/%}/g, "$1")
      // {% booking_status status="RESERVED" ... /%} → Reserved
      .replace(
        /{%\s*booking_status\s+status="([^"]*)"[^%]*\/%}/g,
        (_match, status: string) =>
          status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ")
      )
      // {% assets_list count=3 ... action="added" /%} → 3 assets added
      .replace(
        /{%\s*assets_list\s+count=(\d+)[^%]*action="([^"]*)"[^%]*\/%}/g,
        "$1 assets $2"
      )
      // {% kits_list count=2 ... action="added" /%} → 2 kits added
      .replace(
        /{%\s*kits_list\s+count=(\d+)[^%]*action="([^"]*)"[^%]*\/%}/g,
        "$1 kits $2"
      )
      // {% description newText="..." /%} → (description updated)
      .replace(/{%\s*description[^%]*\/%}/g, "(description updated)")
      // Catch any remaining {% ... /%} tags
      .replace(/{%[^%]*\/%}/g, "")
      // Strip **bold** markers
      .replace(/\*\*/g, "")
      // Clean up &quot; entities
      .replace(/&quot;/g, '"')
      // Clean up extra whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

const NoteItem = memo(function NoteItem({
  note,
  timeAgo,
}: {
  note: AssetNote;
  timeAgo: (d: string) => string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const userName = note.user
    ? [note.user.firstName, note.user.lastName].filter(Boolean).join(" ") ||
      "User"
    : "System";
  const isUpdate = note.type === "UPDATE";

  return (
    <View style={[styles.noteItem, isUpdate && styles.noteItemUpdate]}>
      <View style={styles.noteHeader}>
        <View style={styles.noteUserRow}>
          <View
            style={[styles.noteAvatar, isUpdate && styles.noteAvatarUpdate]}
          >
            <Ionicons
              name={isUpdate ? "refresh-outline" : "chatbubble-outline"}
              size={12}
              color={isUpdate ? colors.muted : colors.primaryForeground}
            />
          </View>
          <Text style={styles.noteUserName}>{userName}</Text>
        </View>
        <Text style={styles.noteTime}>{timeAgo(note.createdAt)}</Text>
      </View>
      <Text style={styles.noteContent} selectable>
        {markdocToPlainText(note.content)}
      </Text>
    </View>
  );
});

// ── Styles ─────────────────────────────────────────────

const useStyles = createStyles((colors, shadows) => ({
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  content: { paddingBottom: 40 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  errorText: {
    fontSize: fontSize.xl,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: spacing.xxxl,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 10,
    borderRadius: borderRadius.md,
    marginTop: spacing.sm,
  },
  retryText: {
    color: colors.primaryForeground,
    fontWeight: "600",
    fontSize: fontSize.base,
  },

  // Hero
  heroImage: {
    width: "100%",
    height: 220,
    backgroundColor: colors.backgroundTertiary,
  },
  heroPlaceholder: { justifyContent: "center", alignItems: "center" },
  heroEditBtn: {
    position: "absolute",
    bottom: spacing.sm,
    right: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.gray300,
    ...shadows.sm,
  },
  heroEditBtnText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
  },
  heroOverlayText: {
    color: "#fff",
    fontSize: fontSize.base,
    fontWeight: "600",
  },

  // Title
  titleSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: fontSize.xxxl,
    fontWeight: "700",
    color: colors.foreground,
    flex: 1,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.pill,
    gap: 4,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: fontSize.xs, fontWeight: "500" },
  description: {
    fontSize: fontSize.lg,
    color: colors.foregroundSecondary,
    lineHeight: 22,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },

  // Quick actions
  actionsSection: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  primaryActionBlack: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    gap: spacing.sm,
    ...shadows.sm,
  },
  primaryActionGreen: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.available,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    gap: spacing.sm,
    ...shadows.sm,
  },
  primaryActionText: {
    color: colors.primaryForeground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  secondaryActionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  secondaryAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.gray300,
    gap: 4,
  },
  secondaryActionText: {
    color: colors.gray700,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  secondaryActionTextMuted: {
    color: colors.muted,
    fontSize: fontSize.sm,
    fontWeight: "500",
  },
  actionLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionLoadingText: { fontSize: fontSize.base, color: colors.muted },

  // Overflow menu
  overflowBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  overflowMenu: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    width: "75%",
    overflow: "hidden",
    ...shadows.lg,
  },
  overflowItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 16,
  },
  overflowItemTextDanger: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.error,
  },

  // Info card
  infoSection: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadows.sm,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  infoLabelText: { fontSize: fontSize.base, color: colors.muted },
  infoValue: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
    maxWidth: "55%",
    textAlign: "right",
  },

  // Section containers (tags, custom fields, activity)
  sectionContainer: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },

  // Tags
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tag: {
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagText: { fontSize: fontSize.sm, color: colors.gray700 },

  // Custom fields
  customFieldsCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadows.sm,
  },
  customFieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  customFieldLabel: { fontSize: fontSize.base, color: colors.muted, flex: 1 },
  customFieldValue: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
    flex: 1,
    textAlign: "right",
  },

  // Notes input
  noteInputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  noteInput: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gray300,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: fontSize.base,
    color: colors.foreground,
    maxHeight: 80,
    minHeight: 40,
    ...shadows.sm,
  },
  notePostBtn: {
    backgroundColor: colors.primary,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  notePostBtnDisabled: { opacity: 0.4 },

  // Notes list
  notesList: { gap: spacing.sm },
  emptyNotes: {
    fontSize: fontSize.base,
    color: colors.mutedLight,
    textAlign: "center",
    paddingVertical: spacing.xl,
  },
  noteItem: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteItemUpdate: {
    borderColor: colors.borderLight,
    backgroundColor: colors.backgroundTertiary,
  },
  noteHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  noteUserRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  noteAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  noteAvatarUpdate: {
    backgroundColor: colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteUserName: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
  },
  noteTime: { fontSize: fontSize.xs, color: colors.mutedLight },
  noteContent: {
    fontSize: fontSize.base,
    color: colors.foregroundSecondary,
    lineHeight: 20,
  },

  // QR Code
  qrCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    ...shadows.sm,
  },
  qrIdText: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  qrExtraText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },

  // Image zoom modal
  zoomOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  zoomCloseBtn: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  zoomImage: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height * 0.7,
  },
}));
