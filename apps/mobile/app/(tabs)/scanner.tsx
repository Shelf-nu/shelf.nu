import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Linking,
  Platform,
  ScrollView,
  Alert,
  FlatList,
  PanResponder,
  Dimensions,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { api, type QrResponse, type BookingDetail } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { TeamMemberPicker } from "@/components/team-member-picker";
import { LocationPicker } from "@/components/location-picker";
import type { TeamMember, Location as LocationType } from "@/lib/api";
import { fontSize, spacing, borderRadius, hitSlop } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { extractQrId } from "@/lib/qr-utils";
import { announce, useReducedMotion } from "@/lib/a11y";

// ── Error Boundary ──────────────────────────────────────
import React from "react";

/** Functional fallback component that can use hooks for theming */
function ScannerErrorFallback({ onRetry }: { onRetry: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.centered}>
      <Ionicons name="warning-outline" size={48} color={colors.error} />
      <Text style={styles.messageTitle}>Camera Error</Text>
      <Text style={styles.messageBody}>
        Something went wrong with the camera.
      </Text>
      <TouchableOpacity style={styles.actionButton} onPress={onRetry}>
        <Text style={styles.actionButtonText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

class ScannerErrorBoundary extends React.Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn("[Scanner] Error boundary caught:", error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <ScannerErrorFallback
          onRetry={() => this.setState({ hasError: false })}
        />
      );
    }
    return this.props.children;
  }
}

// ── Action Types ────────────────────────────────────────

type ScannerAction =
  | "view"
  | "assign_custody"
  | "release_custody"
  | "update_location";

const SCANNER_ACTIONS: {
  key: ScannerAction;
  label: string;
  icon: string;
}[] = [
  { key: "view", label: "View", icon: "eye-outline" },
  { key: "assign_custody", label: "Assign", icon: "person-add-outline" },
  { key: "release_custody", label: "Release", icon: "person-remove-outline" },
  { key: "update_location", label: "Location", icon: "location-outline" },
];

const isBatchAction = (a: ScannerAction) => a !== "view";

/** Cooldown period (ms) before the same code can be re-scanned */
const SCAN_COOLDOWN_MS = 3_000;

const SCREEN_WIDTH = Dimensions.get("window").width;

// ── Scanned Item Type ───────────────────────────────────

type ScannedItem = {
  qrId: string;
  assetId: string;
  title: string;
  status: string;
  mainImage: string | null;
  category: string | null;
};

// ── Scanner Content ─────────────────────────────────────

function ScannerContent() {
  const router = useRouter();
  const { bookingId, bookingName } = useLocalSearchParams<{
    bookingId?: string;
    bookingName?: string;
  }>();
  const isFocused = useIsFocused();
  const { currentOrg } = useOrg();
  const { colors } = useTheme();
  const styles = useStyles();
  const [permission, requestPermission] = useCameraPermissions();

  // Booking check-in mode
  const isBookingMode = !!bookingId;

  // Action state
  const [action, setAction] = useState<ScannerAction>("view");

  // Single-scan state (for "view" mode)
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false); // ref guard for race condition
  const [scanResult, setScanResult] = useState<{
    type: "success" | "error" | "not_found";
    title: string;
    message: string;
  } | null>(null);

  // Batch state (for assign/release/location modes)
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pickers
  const [showCustodyPicker, setShowCustodyPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  // Flashlight
  const [torchEnabled, setTorchEnabled] = useState(false);

  // Pause/freeze camera (inspired by Scandit freeze pattern)
  const [isPaused, setIsPaused] = useState(false);

  // Frame highlight on scan (inspired by Scandit/Scanbot frame animation)
  const [frameHighlight, setFrameHighlight] = useState<
    "success" | "error" | null
  >(null);
  const frameHighlightTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Booking check-in items (separate from batch scan)
  const [bookingCheckinItems, setBookingCheckinItems] = useState<ScannedItem[]>(
    []
  );
  const [isBookingSubmitting, setIsBookingSubmitting] = useState(false);

  // Cooldown
  const lastScanRef = useRef<string>("");
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inactivity auto-pause (inspired by Scandit's 8-10s camera timeout)
  const INACTIVITY_TIMEOUT_MS = 30_000;
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetInactivityTimer = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(() => {
      setIsPaused(true);
    }, INACTIVITY_TIMEOUT_MS);
  }, []);

  // Start/restart inactivity timer when focused & not paused
  useEffect(() => {
    if (isFocused && !isPaused) {
      resetInactivityTimer();
    }
    return () => {
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
    };
  }, [isFocused, isPaused, resetInactivityTimer]);

  // Toggle pause handler
  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      if (prev) {
        // Resuming — restart inactivity timer
        resetInactivityTimer();
      }
      return !prev;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [resetInactivityTimer]);

  // Flash frame corners on scan result
  const flashFrame = useCallback((type: "success" | "error") => {
    if (frameHighlightTimer.current) clearTimeout(frameHighlightTimer.current);
    setFrameHighlight(type);
    frameHighlightTimer.current = setTimeout(() => {
      setFrameHighlight(null);
    }, 500);
  }, []);

  // Animation for scan line
  const reduceMotion = useReducedMotion();
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isFocused || isPaused) return;
    if (reduceMotion) {
      scanLineAnim.setValue(0.5); // Static midpoint position
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, {
          toValue: 1,
          duration: 2500,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(scanLineAnim, {
          toValue: 0,
          duration: 2500,
          useNativeDriver: Platform.OS !== "web",
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isFocused, isPaused, scanLineAnim, reduceMotion]);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
      if (frameHighlightTimer.current)
        clearTimeout(frameHighlightTimer.current);
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
    };
  }, []);

  // ── Swipe Gesture (Instagram-style mode switching) ──────────
  const swipeTranslateX = useRef(new Animated.Value(0)).current;
  const swipeOpacity = useRef(new Animated.Value(1)).current;
  const isSwipingRef = useRef(false);
  const actionIndexRef = useRef(0);

  // Keep refs in sync for the PanResponder (avoids stale closures)
  const isBookingModeRef = useRef(isBookingMode);
  useEffect(() => {
    isBookingModeRef.current = isBookingMode;
  }, [isBookingMode]);
  const isPausedRef = useRef(isPaused);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);
  const isSubmittingRef = useRef(isSubmitting);
  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);
  const scannedItemsCountRef = useRef(scannedItems.length);
  useEffect(() => {
    scannedItemsCountRef.current = scannedItems.length;
  }, [scannedItems.length]);

  useEffect(() => {
    const idx = SCANNER_ACTIONS.findIndex((a) => a.key === action);
    actionIndexRef.current = idx >= 0 ? idx : 0;
  }, [action]);

  // Clear batch items when switching actions
  const handleActionChange = useCallback(
    (newAction: ScannerAction) => {
      if (scannedItems.length > 0 && newAction !== action) {
        Alert.alert(
          "Switch Action?",
          `You have ${scannedItems.length} scanned item${
            scannedItems.length > 1 ? "s" : ""
          }. Switching will clear them.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Switch",
              style: "destructive",
              onPress: () => {
                setScannedItems([]);
                setScanResult(null);
                lastScanRef.current = "";
                setAction(newAction);
              },
            },
          ]
        );
      } else {
        setAction(newAction);
      }
    },
    [action, scannedItems.length]
  );

  // ── Swipe transition animation ─────────────────────────
  const triggerSwipeTransition = useCallback(
    (nextAction: ScannerAction, direction: number) => {
      if (isSwipingRef.current) return;
      isSwipingRef.current = true;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // If batch items exist, skip animation and delegate to existing Alert flow
      if (scannedItemsCountRef.current > 0) {
        handleActionChange(nextAction);
        isSwipingRef.current = false;
        return;
      }

      // Skip animation when reduced motion is enabled
      if (reduceMotion) {
        setAction(nextAction);
        swipeTranslateX.setValue(0);
        swipeOpacity.setValue(1);
        isSwipingRef.current = false;
        return;
      }

      // Smooth 2-phase slide: out → change → in
      Animated.parallel([
        Animated.timing(swipeTranslateX, {
          toValue: direction * SCREEN_WIDTH * 0.3,
          duration: 150,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(swipeOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: Platform.OS !== "web",
        }),
      ]).start(() => {
        // Midpoint: switch mode
        setAction(nextAction);

        // Position text on opposite side, then slide in
        swipeTranslateX.setValue(-direction * SCREEN_WIDTH * 0.3);

        Animated.parallel([
          Animated.timing(swipeTranslateX, {
            toValue: 0,
            duration: 200,
            useNativeDriver: Platform.OS !== "web",
          }),
          Animated.timing(swipeOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: Platform.OS !== "web",
          }),
        ]).start(() => {
          isSwipingRef.current = false;
        });
      });
    },
    [handleActionChange, swipeTranslateX, swipeOpacity, reduceMotion]
  );

  // ── Swipe PanResponder ──────────────────────────────────
  const swipePanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, { dx, dy }) => {
        if (isBookingModeRef.current) return false;
        if (isProcessingRef.current) return false;
        if (isPausedRef.current) return false;
        if (isSubmittingRef.current) return false;
        if (isSwipingRef.current) return false;
        // Require clearly horizontal gesture
        return Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5;
      },
      onPanResponderRelease: (_evt, { dx, vx }) => {
        const SWIPE_THRESHOLD = 50;
        const VELOCITY_THRESHOLD = 0.3;

        const swipedLeft = dx < -SWIPE_THRESHOLD || vx < -VELOCITY_THRESHOLD;
        const swipedRight = dx > SWIPE_THRESHOLD || vx > VELOCITY_THRESHOLD;
        if (!swipedLeft && !swipedRight) return;

        const currentIdx = actionIndexRef.current;
        const nextIdx = swipedLeft
          ? (currentIdx + 1) % SCANNER_ACTIONS.length
          : (currentIdx - 1 + SCANNER_ACTIONS.length) % SCANNER_ACTIONS.length;

        if (nextIdx === currentIdx) return;

        const nextAction = SCANNER_ACTIONS[nextIdx].key;
        const direction = swipedLeft ? -1 : 1;
        // Call triggerSwipeTransition via a ref since PanResponder is created once
        triggerSwipeRef.current?.(nextAction, direction);
      },
      onPanResponderTerminationRequest: () => true,
    })
  ).current;

  // Ref to always hold the latest triggerSwipeTransition callback
  const triggerSwipeRef = useRef(triggerSwipeTransition);
  useEffect(() => {
    triggerSwipeRef.current = triggerSwipeTransition;
  }, [triggerSwipeTransition]);

  const startCooldown = () => {
    if (cooldownRef.current) clearTimeout(cooldownRef.current);
    cooldownRef.current = setTimeout(() => {
      lastScanRef.current = "";
    }, SCAN_COOLDOWN_MS);
  };

  /** Release the processing lock and start the cooldown timer */
  const finalizeScan = () => {
    isProcessingRef.current = false;
    setIsProcessing(false);
    startCooldown();
  };

  // ── Scan Handler ────────────────────────────────────

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (isProcessingRef.current || data === lastScanRef.current) return;

      isProcessingRef.current = true;
      lastScanRef.current = data;
      setIsProcessing(true);
      setScanResult(null);
      resetInactivityTimer();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      try {
        const qrId = extractQrId(data);
        let codeId: string;
        let codeOrgId: string | null;
        let asset: {
          id: string;
          title: string;
          status: string;
          mainImage: string | null;
          category: { name: string } | null;
          location: { name: string } | null;
        } | null;

        if (qrId) {
          // ── Shelf QR path ──

          // Early batch dedup by QR ID (saves a network call)
          if (
            isBatchAction(action) &&
            scannedItems.some((item) => item.qrId === qrId)
          ) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setScanResult({
              type: "error",
              title: "Already Scanned",
              message: "This asset is already in your scan list.",
            });
            finalizeScan();
            return;
          }

          const { data: qrData, error } = await api.qr(qrId);

          if (error || !qrData) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setScanResult({
              type: "error",
              title: "Lookup Failed",
              message: error || "Could not look up this QR code.",
            });
            finalizeScan();
            return;
          }

          codeId = qrId;
          codeOrgId = qrData.qr?.organizationId ?? null;
          asset = qrData.qr?.asset ?? null;
        } else {
          // ── Barcode fallback path ──
          // Code isn't a Shelf QR — try looking it up as a barcode

          if (!currentOrg) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            announce("Code not recognized");
            setScanResult({
              type: "not_found",
              title: "Code Not Recognized",
              message: "This code is not recognized as a Shelf asset code.",
            });
            finalizeScan();
            return;
          }

          if (!currentOrg.barcodesEnabled) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            announce("Barcode scanning not available");
            setScanResult({
              type: "not_found",
              title: "Barcode Not Supported",
              message:
                "Your workspace does not support barcode scanning. Contact your admin to enable this feature.",
            });
            finalizeScan();
            return;
          }

          const { data: barcodeData, error: barcodeError } = await api.barcode(
            data,
            currentOrg.id
          );

          if (barcodeError || !barcodeData) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            announce("Code not recognized");
            setScanResult({
              type: "not_found",
              title: "Code Not Recognized",
              message:
                barcodeError || "This code was not found in your workspace.",
            });
            finalizeScan();
            return;
          }

          codeId = barcodeData.barcode.id;
          codeOrgId = barcodeData.barcode.organizationId;
          asset = barcodeData.barcode.asset;
        }

        // ── Shared processing (QR and barcode paths converge here) ──

        // Cross-org check
        if (currentOrg && codeOrgId && codeOrgId !== currentOrg.id) {
          flashFrame("error");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setScanResult({
            type: "error",
            title: "Different Workspace",
            message:
              "This asset belongs to a different workspace. Switch workspaces to view it.",
          });
          finalizeScan();
          return;
        }

        if (!asset) {
          flashFrame("error");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setScanResult({
            type: "not_found",
            title: "No Asset Linked",
            message: "This code exists but is not linked to any asset.",
          });
          finalizeScan();
          return;
        }

        // ── BOOKING CHECK-IN mode ──
        if (isBookingMode) {
          // Check duplicate
          if (bookingCheckinItems.some((item) => item.assetId === asset.id)) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setScanResult({
              type: "error",
              title: "Already Scanned",
              message: "This asset is already in your check-in list.",
            });
            finalizeScan();
            return;
          }

          const newItem: ScannedItem = {
            qrId: codeId,
            assetId: asset.id,
            title: asset.title,
            status: asset.status,
            mainImage: asset.mainImage,
            category: asset.category?.name || null,
          };

          if (asset.status !== "CHECKED_OUT") {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setScanResult({
              type: "error",
              title: "Not Checked Out",
              message: `"${asset.title}" is ${asset.status
                .replace(/_/g, " ")
                .toLowerCase()}, not checked out.`,
            });
            finalizeScan();
            return;
          }

          setBookingCheckinItems((prev) => [newItem, ...prev]);
          flashFrame("success");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setScanResult({
            type: "success",
            title: asset.title,
            message: `Added to check-in (${
              bookingCheckinItems.length + 1
            } items)`,
          });

          setTimeout(() => setScanResult(null), 1200);
          finalizeScan();
          return;
        }

        // ── VIEW mode: navigate to detail ──
        if (action === "view") {
          const statusLabel =
            asset.status === "IN_CUSTODY"
              ? "In Custody"
              : asset.status === "AVAILABLE"
              ? "Available"
              : asset.status.replace(/_/g, " ");

          flashFrame("success");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          announce("Code scanned successfully");
          setScanResult({
            type: "success",
            title: asset.title,
            message: `${asset.category?.name || "Asset"} • ${statusLabel}`,
          });

          // Brief confirmation delay (Scandit UX research: brief pause
          // lets visual feedback register before transitioning)
          setTimeout(() => {
            router.push(`/(tabs)/assets/${asset.id}`);
            setScanResult(null);
            finalizeScan();
          }, 950);
          return;
        }

        // ── BATCH mode: add to list ──
        // Dedup by assetId (catches same asset via QR + barcode)
        if (scannedItems.some((item) => item.assetId === asset.id)) {
          flashFrame("error");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setScanResult({
            type: "error",
            title: "Already Scanned",
            message: "This asset is already in your scan list.",
          });
          finalizeScan();
          return;
        }

        const newItem: ScannedItem = {
          qrId: codeId,
          assetId: asset.id,
          title: asset.title,
          status: asset.status,
          mainImage: asset.mainImage,
          category: asset.category?.name || null,
        };

        setScannedItems((prev) => [newItem, ...prev]);
        flashFrame("success");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setScanResult({
          type: "success",
          title: asset.title,
          message: `Added to list (${scannedItems.length + 1} items)`,
        });

        // Clear result quickly so scanner stays active
        setTimeout(() => {
          setScanResult(null);
        }, 1200);

        finalizeScan();
      } catch (err) {
        if (__DEV__) console.error("[Scanner] Error:", err);
        flashFrame("error");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setScanResult({
          type: "error",
          title: "Error",
          message: "Something went wrong while scanning.",
        });
        finalizeScan();
      }
    },
    [
      router,
      action,
      currentOrg,
      scannedItems,
      isBookingMode,
      bookingCheckinItems,
      flashFrame,
      resetInactivityTimer,
    ]
  );

  const dismissResult = useCallback(() => {
    setScanResult(null);
    lastScanRef.current = "";
  }, []);

  // ── Batch Actions ──────────────────────────────────

  const removeItem = (qrId: string) => {
    setScannedItems((prev) => prev.filter((i) => i.qrId !== qrId));
  };

  const clearAll = () => {
    setScannedItems([]);
    lastScanRef.current = "";
  };

  const handleBatchSubmit = () => {
    if (scannedItems.length === 0) return;

    if (action === "assign_custody") {
      setShowCustodyPicker(true);
    } else if (action === "release_custody") {
      const releasable = scannedItems.filter((i) => i.status === "IN_CUSTODY");
      if (releasable.length === 0) {
        Alert.alert(
          "No Assets to Release",
          "None of the scanned assets are currently in custody."
        );
        return;
      }
      Alert.alert(
        "Release Custody",
        `Release custody of ${releasable.length} asset${
          releasable.length > 1 ? "s" : ""
        }?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Release",
            style: "destructive",
            onPress: () => performBulkRelease(),
          },
        ]
      );
    } else if (action === "update_location") {
      setShowLocationPicker(true);
    }
  };

  const performBulkAssign = async (member: TeamMember) => {
    setShowCustodyPicker(false);
    if (!currentOrg) return;

    const displayName = member.user
      ? [member.user.firstName, member.user.lastName]
          .filter(Boolean)
          .join(" ") || member.name
      : member.name;

    Alert.alert(
      "Assign Custody",
      `Assign ${scannedItems.length} asset${
        scannedItems.length > 1 ? "s" : ""
      } to ${displayName}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Assign",
          onPress: async () => {
            setIsSubmitting(true);
            const assetIds = scannedItems.map((i) => i.assetId);
            const { data: result, error } = await api.bulkAssignCustody(
              currentOrg.id,
              assetIds,
              member.id
            );
            setIsSubmitting(false);

            if (error) {
              Alert.alert("Error", error);
            } else {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success
              );
              const msg = result?.skipped
                ? `Assigned ${result.assigned} asset${
                    (result.assigned ?? 0) > 1 ? "s" : ""
                  }. ${result.skipped} skipped (already in custody).`
                : `Assigned ${result?.assigned} asset${
                    (result?.assigned ?? 0) > 1 ? "s" : ""
                  } to ${displayName}.`;
              Alert.alert("Done", msg);
              setScannedItems([]);
              lastScanRef.current = "";
            }
          },
        },
      ]
    );
  };

  const performBulkRelease = async () => {
    if (!currentOrg) return;
    setIsSubmitting(true);
    const assetIds = scannedItems.map((i) => i.assetId);
    const { data: result, error } = await api.bulkReleaseCustody(
      currentOrg.id,
      assetIds
    );
    setIsSubmitting(false);

    if (error) {
      Alert.alert("Error", error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const msg = result?.skipped
        ? `Released ${result.released} asset${
            (result.released ?? 0) > 1 ? "s" : ""
          }. ${result.skipped} skipped (not in custody).`
        : `Released ${result?.released} asset${
            (result?.released ?? 0) > 1 ? "s" : ""
          }.`;
      Alert.alert("Done", msg);
      setScannedItems([]);
      lastScanRef.current = "";
    }
  };

  const performBulkUpdateLocation = async (location: LocationType) => {
    setShowLocationPicker(false);
    if (!currentOrg) return;

    Alert.alert(
      "Update Location",
      `Move ${scannedItems.length} asset${
        scannedItems.length > 1 ? "s" : ""
      } to ${location.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Move",
          onPress: async () => {
            setIsSubmitting(true);
            const assetIds = scannedItems.map((i) => i.assetId);
            const { data: result, error } = await api.bulkUpdateLocation(
              currentOrg.id,
              assetIds,
              location.id
            );
            setIsSubmitting(false);

            if (error) {
              Alert.alert("Error", error);
            } else {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success
              );
              const msg = result?.skipped
                ? `Moved ${result.updated} asset${
                    (result.updated ?? 0) > 1 ? "s" : ""
                  }. ${result.skipped} already at this location.`
                : `Moved ${result?.updated} asset${
                    (result?.updated ?? 0) > 1 ? "s" : ""
                  } to ${location.name}.`;
              Alert.alert("Done", msg);
              setScannedItems([]);
              lastScanRef.current = "";
            }
          },
        },
      ]
    );
  };

  // ── Booking Check-in Actions ────────────────────────

  const removeBookingItem = (assetId: string) => {
    setBookingCheckinItems((prev) => prev.filter((i) => i.assetId !== assetId));
  };

  const clearBookingItems = () => {
    setBookingCheckinItems([]);
    lastScanRef.current = "";
  };

  const handleBookingCheckin = () => {
    if (!bookingId || !currentOrg || bookingCheckinItems.length === 0) return;

    const count = bookingCheckinItems.length;
    Alert.alert(
      "Check In Assets",
      `Check in ${count} ${count === 1 ? "asset" : "assets"} for "${
        bookingName || "this booking"
      }"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Check In",
          onPress: async () => {
            setIsBookingSubmitting(true);
            const assetIds = bookingCheckinItems.map((i) => i.assetId);
            const timeZone = (() => {
              try {
                return (
                  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
                );
              } catch {
                return "UTC";
              }
            })();

            const { data: result, error } = await api.partialCheckinBooking(
              currentOrg.id,
              bookingId,
              assetIds,
              timeZone
            );
            setIsBookingSubmitting(false);

            if (error) {
              Alert.alert("Error", error);
              return;
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            const msg = result?.isComplete
              ? `All assets checked in! "${
                  bookingName || "Booking"
                }" is now complete.`
              : `${result?.checkedInCount} checked in, ${result?.remainingCount} remaining.`;
            Alert.alert("Checked In", msg, [
              {
                text: "OK",
                onPress: () => {
                  setBookingCheckinItems([]);
                  lastScanRef.current = "";
                  if (result?.isComplete) {
                    router.back();
                  }
                },
              },
            ]);
          },
        },
      ]
    );
  };

  // ── Permission states ───────────────────────────────

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Ionicons name="camera-outline" size={64} color={colors.mutedLight} />
        <Text style={styles.messageTitle}>Camera Access Needed</Text>
        <Text style={styles.messageBody}>
          Shelf needs camera access to scan QR codes and barcodes on your
          assets.
        </Text>
        {permission.canAskAgain ? (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={requestPermission}
          >
            <Text style={styles.actionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              if (Platform.OS === "ios") {
                Linking.openURL("app-settings:");
              } else {
                Linking.openSettings();
              }
            }}
          >
            <Text style={styles.actionButtonText}>Open Settings</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── Camera view ──────────────────────────────────────

  const scanLineTranslate = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 220],
  });

  const showBatchDrawer =
    !isBookingMode && isBatchAction(action) && scannedItems.length > 0;
  const showBookingDrawer = isBookingMode && bookingCheckinItems.length > 0;

  // Instruction text
  const instructionMap: Record<ScannerAction, string> = {
    view: "Scan to view asset",
    assign_custody: "Scan assets to assign custody",
    release_custody: "Scan assets to release custody",
    update_location: "Scan assets to update location",
  };

  // Submit button label
  const submitLabelMap: Record<ScannerAction, string> = {
    view: "",
    assign_custody: "Choose Custodian",
    release_custody: "Release All",
    update_location: "Choose Location",
  };

  return (
    <View style={styles.container}>
      {isFocused && !isPaused && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torchEnabled}
          barcodeScannerSettings={{
            barcodeTypes: ["qr", "code128", "code39", "datamatrix", "ean13"],
          }}
          onBarcodeScanned={
            isProcessing || (scanResult && action === "view" && !isBookingMode)
              ? undefined
              : handleBarCodeScanned
          }
        />
      )}

      {/* Paused overlay (inspired by Scandit freeze-frame pattern) */}
      {isPaused && (
        <TouchableOpacity
          style={styles.pausedOverlay}
          onPress={togglePause}
          activeOpacity={0.9}
          accessibilityLabel="Camera paused. Tap to resume scanning"
          accessibilityRole="button"
        >
          <Ionicons
            name="play-circle-outline"
            size={64}
            color="rgba(255,255,255,0.8)"
          />
          <Text style={styles.pausedTitle}>Camera Paused</Text>
          <Text style={styles.pausedSubtitle}>
            Tap anywhere to resume scanning
          </Text>
        </TouchableOpacity>
      )}

      {/* Overlay with cutout */}
      <View style={styles.overlay}>
        {/* Top - Action picker or Booking header */}
        <View style={styles.overlaySection}>
          {isBookingMode ? (
            <View style={styles.actionPickerContainer}>
              <View style={styles.bookingModeHeader}>
                <TouchableOpacity
                  onPress={() => router.back()}
                  accessibilityLabel="Go back"
                  accessibilityRole="button"
                >
                  <Ionicons name="arrow-back" size={22} color="#fff" />
                </TouchableOpacity>
                <View style={styles.bookingModeInfo}>
                  <Text style={styles.bookingModeLabel}>Booking Check-In</Text>
                  <Text style={styles.bookingModeName} numberOfLines={1}>
                    {bookingName || "Scan assets to check in"}
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.actionPickerContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.actionPickerScroll}
              >
                {SCANNER_ACTIONS.map((a) => (
                  <TouchableOpacity
                    key={a.key}
                    style={[
                      styles.actionPill,
                      action === a.key && styles.actionPillActive,
                    ]}
                    onPress={() => handleActionChange(a.key)}
                    activeOpacity={0.7}
                    accessibilityLabel={`Scanner action: ${a.label}${
                      action === a.key ? ", selected" : ""
                    }`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: action === a.key }}
                  >
                    <Ionicons
                      name={a.icon as any}
                      size={16}
                      color={
                        action === a.key ? "#fff" : "rgba(255,255,255,0.7)"
                      }
                    />
                    <Text
                      style={[
                        styles.actionPillText,
                        action === a.key && styles.actionPillTextActive,
                      ]}
                    >
                      {a.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        {/* Middle row — swipe gesture target */}
        <View style={styles.middleRow} {...swipePanResponder.panHandlers}>
          <View style={styles.overlaySection} />
          <View style={styles.scanFrame}>
            {/* Frame corners flash green/red on detect (Scandit/Scanbot pattern) */}
            <View
              style={[
                styles.corner,
                styles.cornerTL,
                frameHighlight && {
                  borderColor:
                    frameHighlight === "success" ? "#4CAF50" : "#F04438",
                },
              ]}
            />
            <View
              style={[
                styles.corner,
                styles.cornerTR,
                frameHighlight && {
                  borderColor:
                    frameHighlight === "success" ? "#4CAF50" : "#F04438",
                },
              ]}
            />
            <View
              style={[
                styles.corner,
                styles.cornerBL,
                frameHighlight && {
                  borderColor:
                    frameHighlight === "success" ? "#4CAF50" : "#F04438",
                },
              ]}
            />
            <View
              style={[
                styles.corner,
                styles.cornerBR,
                frameHighlight && {
                  borderColor:
                    frameHighlight === "success" ? "#4CAF50" : "#F04438",
                },
              ]}
            />
            {!scanResult && !isPaused && (
              <Animated.View
                style={[
                  styles.scanLine,
                  { transform: [{ translateY: scanLineTranslate }] },
                ]}
              />
            )}
          </View>
          <View style={styles.overlaySection} />
        </View>

        {/* Bottom */}
        <View
          style={[
            styles.overlaySection,
            styles.bottomSection,
            (showBatchDrawer || showBookingDrawer) && {
              flex: 0,
              paddingTop: spacing.md,
            },
          ]}
        >
          {/* Mode indicator dots */}
          {!isBookingMode && (
            <View style={styles.modeDotsContainer}>
              {SCANNER_ACTIONS.map((a) => (
                <View
                  key={a.key}
                  style={[
                    styles.modeDot,
                    action === a.key && styles.modeDotActive,
                  ]}
                />
              ))}
            </View>
          )}

          {/* Status / instruction text — animated for swipe transitions */}
          <Animated.View
            style={[
              styles.instructionContainer,
              {
                transform: [{ translateX: swipeTranslateX }],
                opacity: swipeOpacity,
              },
            ]}
          >
            {isProcessing && !scanResult ? (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.instructionText}>Looking up asset...</Text>
              </View>
            ) : scanResult ? (
              <TouchableOpacity
                style={[
                  styles.resultCard,
                  scanResult.type === "success" && styles.resultCardSuccess,
                  scanResult.type === "error" && styles.resultCardError,
                  scanResult.type === "not_found" && styles.resultCardWarning,
                ]}
                onPress={dismissResult}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={
                    scanResult.type === "success"
                      ? "checkmark-circle"
                      : scanResult.type === "error"
                      ? "alert-circle"
                      : "help-circle"
                  }
                  size={24}
                  color="#fff"
                />
                <View style={styles.resultTextContainer}>
                  <Text style={styles.resultTitle}>{scanResult.title}</Text>
                  <Text style={styles.resultMessage}>{scanResult.message}</Text>
                </View>
                {scanResult.type !== "success" && (
                  <Ionicons
                    name="close"
                    size={20}
                    color="rgba(255,255,255,0.7)"
                  />
                )}
              </TouchableOpacity>
            ) : (
              <Text style={styles.instructionText}>
                {isBookingMode
                  ? "Scan assets to check in"
                  : instructionMap[action]}
              </Text>
            )}
          </Animated.View>

          {/* Camera controls — positioned in the thumb-friendly bottom zone */}
          <View style={styles.controlButtons}>
            {/* Pause/Resume toggle */}
            <TouchableOpacity
              style={[
                styles.controlButton,
                isPaused && styles.controlButtonActive,
              ]}
              onPress={togglePause}
              accessibilityLabel={isPaused ? "Resume camera" : "Pause camera"}
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <Ionicons
                name={isPaused ? "play" : "pause"}
                size={20}
                color="#fff"
              />
            </TouchableOpacity>
            {/* Flashlight toggle */}
            <TouchableOpacity
              style={[
                styles.controlButton,
                torchEnabled && styles.controlButtonActive,
              ]}
              onPress={() => setTorchEnabled((prev) => !prev)}
              accessibilityLabel={
                torchEnabled ? "Turn off flashlight" : "Turn on flashlight"
              }
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <Ionicons
                name={torchEnabled ? "flash" : "flash-outline"}
                size={20}
                color={torchEnabled ? "#FFD600" : "#fff"}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Batch Drawer ────────────────────────────── */}
        {showBatchDrawer && (
          <View style={styles.batchDrawer}>
            {/* Drawer header */}
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>
                {scannedItems.length} asset
                {scannedItems.length > 1 ? "s" : ""} scanned
              </Text>
              <TouchableOpacity
                onPress={clearAll}
                accessibilityLabel="Clear all scanned items"
                accessibilityRole="button"
              >
                <Text style={styles.drawerClear}>Clear all</Text>
              </TouchableOpacity>
            </View>

            {/* Item list */}
            <FlatList
              data={scannedItems}
              keyExtractor={(item) => item.qrId}
              style={styles.drawerList}
              renderItem={({ item }) => (
                <View style={styles.drawerItem}>
                  {item.mainImage ? (
                    <Image
                      source={{ uri: item.mainImage }}
                      style={styles.drawerItemImage}
                      contentFit="cover"
                    />
                  ) : (
                    <View
                      style={[
                        styles.drawerItemImage,
                        styles.drawerItemImagePlaceholder,
                      ]}
                    >
                      <Ionicons
                        name="cube-outline"
                        size={16}
                        color={colors.muted}
                      />
                    </View>
                  )}
                  <View style={styles.drawerItemInfo}>
                    <Text style={styles.drawerItemTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.drawerItemMeta}>
                      {item.category || "Asset"} •{" "}
                      {item.status === "IN_CUSTODY"
                        ? "In Custody"
                        : item.status === "AVAILABLE"
                        ? "Available"
                        : item.status.replace(/_/g, " ")}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => removeItem(item.qrId)}
                    hitSlop={hitSlop.md}
                    accessibilityLabel={`Remove ${item.title}`}
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name="close-circle"
                      size={22}
                      color={colors.muted}
                    />
                  </TouchableOpacity>
                </View>
              )}
            />

            {/* Submit button */}
            <TouchableOpacity
              style={[styles.drawerSubmitBtn, isSubmitting && { opacity: 0.6 }]}
              onPress={handleBatchSubmit}
              disabled={isSubmitting}
              activeOpacity={0.7}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons
                    name={
                      (SCANNER_ACTIONS.find((a) => a.key === action)?.icon ||
                        "checkmark") as any
                    }
                    size={20}
                    color="#fff"
                  />
                  <Text style={styles.drawerSubmitText}>
                    {submitLabelMap[action]}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* ── Booking Check-in Drawer ──────────────────── */}
        {showBookingDrawer && (
          <View style={styles.batchDrawer}>
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>
                {bookingCheckinItems.length} asset
                {bookingCheckinItems.length > 1 ? "s" : ""} to check in
              </Text>
              <TouchableOpacity
                onPress={clearBookingItems}
                accessibilityLabel="Clear all check-in items"
                accessibilityRole="button"
              >
                <Text style={styles.drawerClear}>Clear all</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={bookingCheckinItems}
              keyExtractor={(item) => item.assetId}
              style={styles.drawerList}
              renderItem={({ item }) => (
                <View style={styles.drawerItem}>
                  {item.mainImage ? (
                    <Image
                      source={{ uri: item.mainImage }}
                      style={styles.drawerItemImage}
                      contentFit="cover"
                    />
                  ) : (
                    <View
                      style={[
                        styles.drawerItemImage,
                        styles.drawerItemImagePlaceholder,
                      ]}
                    >
                      <Ionicons
                        name="cube-outline"
                        size={16}
                        color={colors.muted}
                      />
                    </View>
                  )}
                  <View style={styles.drawerItemInfo}>
                    <Text style={styles.drawerItemTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.drawerItemMeta}>
                      {item.category || "Asset"}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => removeBookingItem(item.assetId)}
                    hitSlop={hitSlop.md}
                    accessibilityLabel={`Remove ${item.title}`}
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name="close-circle"
                      size={22}
                      color={colors.muted}
                    />
                  </TouchableOpacity>
                </View>
              )}
            />

            <TouchableOpacity
              style={[
                styles.drawerSubmitBtn,
                isBookingSubmitting && { opacity: 0.6 },
              ]}
              onPress={handleBookingCheckin}
              disabled={isBookingSubmitting}
              activeOpacity={0.7}
            >
              {isBookingSubmitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="log-in-outline" size={20} color="#fff" />
                  <Text style={styles.drawerSubmitText}>
                    Check In {bookingCheckinItems.length}{" "}
                    {bookingCheckinItems.length === 1 ? "Asset" : "Assets"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── Pickers (modals) ──────────────────────────── */}
      {currentOrg && (
        <>
          <TeamMemberPicker
            visible={showCustodyPicker}
            orgId={currentOrg.id}
            onSelect={performBulkAssign}
            onClose={() => setShowCustodyPicker(false)}
          />
          <LocationPicker
            visible={showLocationPicker}
            orgId={currentOrg.id}
            onSelect={performBulkUpdateLocation}
            onClose={() => setShowLocationPicker(false)}
          />
        </>
      )}
    </View>
  );
}

// ── Default export wraps with error boundary ─────────────

export default function ScannerScreen() {
  return (
    <ScannerErrorBoundary>
      <ScannerContent />
    </ScannerErrorBoundary>
  );
}

// ── Styles ────────────────────────────────────────────────

const FRAME_SIZE = 240;

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
    padding: spacing.xxl,
    gap: spacing.md,
  },
  messageTitle: {
    fontSize: fontSize.xxl,
    fontWeight: "700",
    color: colors.foreground,
    textAlign: "center",
  },
  messageBody: {
    fontSize: fontSize.lg,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: spacing.lg,
  },
  actionButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    marginTop: spacing.sm,
  },
  actionButtonText: {
    color: colors.primaryForeground,
    fontWeight: "600",
    fontSize: fontSize.xl,
  },

  // Paused overlay
  pausedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
    zIndex: 5,
  },
  pausedTitle: {
    color: "#fff",
    fontSize: fontSize.xxl,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  pausedSubtitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: fontSize.base,
  },

  // Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  controlButtons: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.lg,
    paddingTop: spacing.lg,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  controlButtonActive: {
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  overlaySection: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
  },

  // Action picker
  actionPickerContainer: {
    position: "absolute",
    bottom: spacing.lg,
    left: 0,
    right: 0,
  },
  actionPickerScroll: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  actionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  actionPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  actionPillText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  actionPillTextActive: {
    color: "#fff",
  },
  bookingModeHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  bookingModeInfo: {
    flex: 1,
  },
  bookingModeLabel: {
    fontSize: fontSize.xs,
    color: "rgba(255,255,255,0.6)",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  bookingModeName: {
    fontSize: fontSize.lg,
    color: "#fff",
    fontWeight: "700",
  },
  middleRow: {
    flexDirection: "row",
    height: FRAME_SIZE,
  },
  bottomSection: {
    justifyContent: "flex-start",
    paddingTop: spacing.lg,
  },

  // Mode indicator dots (Instagram-style position indicators)
  modeDotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    paddingBottom: spacing.md,
  },
  modeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  modeDotActive: {
    backgroundColor: colors.primary,
    width: 18,
    borderRadius: 3,
  },

  // Scan frame
  scanFrame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: 30,
    height: 30,
    borderColor: colors.primary,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 6,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 6,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 6,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 6,
  },
  scanLine: {
    position: "absolute",
    left: 8,
    right: 8,
    height: 2,
    backgroundColor: colors.primaryLight,
    borderRadius: 1,
    top: 8,
  },

  // Instructions / results
  instructionContainer: {
    alignItems: "center",
    paddingHorizontal: spacing.xxl,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  instructionText: {
    color: "#fff",
    fontSize: fontSize.lg,
    fontWeight: "600",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // Result card
  resultCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    gap: spacing.md,
    width: "100%",
    maxWidth: 340,
  },
  resultCardSuccess: {
    backgroundColor: "rgba(46,125,50,0.9)",
  },
  resultCardError: {
    backgroundColor: "rgba(240,68,56,0.9)",
  },
  resultCardWarning: {
    backgroundColor: "rgba(239,104,32,0.9)",
  },
  resultTextContainer: {
    flex: 1,
  },
  resultTitle: {
    color: "#fff",
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  resultMessage: {
    color: "rgba(255,255,255,0.85)",
    fontSize: fontSize.sm,
    marginTop: 2,
  },

  // ── Batch Drawer ──────────────────────────────────
  batchDrawer: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: 280,
    ...shadows.md,
  },
  drawerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  drawerTitle: {
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: colors.foreground,
  },
  drawerClear: {
    fontSize: fontSize.sm,
    color: colors.error,
    fontWeight: "600",
  },
  drawerList: {
    maxHeight: 140,
  },
  drawerItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  drawerItemImage: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: colors.backgroundTertiary,
  },
  drawerItemImagePlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  drawerItemInfo: {
    flex: 1,
  },
  drawerItemTitle: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  drawerItemMeta: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 1,
  },
  drawerSubmitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
  },
  drawerSubmitText: {
    color: "#fff",
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
}));
