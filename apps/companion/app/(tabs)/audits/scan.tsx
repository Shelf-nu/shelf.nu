import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
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
  FlatList,
  Alert,
  Dimensions,
  Modal,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import {
  api,
  type AuditDetailResponse,
  type AuditExpectedAsset,
  type AuditScanData,
  type RecordScanResponse,
} from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { extractQrId } from "@/lib/qr-utils";
import { announce } from "@/lib/a11y";
import {
  loadAuditScanState,
  saveAuditScanState,
  clearAuditScanState,
  createDebouncedSaver,
} from "@/lib/audit-scan-persistence";
import React from "react";

// ── Constants ────────────────────────────────────────────

const scanKeyExtractor = (item: ScannedItem) => item.assetId;
const remainingKeyExtractor = (item: RemainingAsset) => item.id;
const SCAN_COOLDOWN_MS = 3_000;
const INACTIVITY_TIMEOUT_MS = 30_000;
const TOAST_DURATION_MS = 1_500;
const SCANNED_ITEM_HEIGHT = 52; // Fixed height for getItemLayout
const REMAINING_ITEM_HEIGHT = 52; // Match scanned item height
const MAX_QUEUE_RETRIES = 3;
const RETRY_DELAYS = [2_000, 5_000, 15_000];

// ── Types ────────────────────────────────────────────────

type ScanResult = "found" | "unexpected" | "duplicate" | "error";

type ScannedItem = {
  assetId: string;
  name: string;
  isExpected: boolean;
  scannedAt: string;
};

type ScanQueueEntry = {
  auditSessionId: string;
  qrId: string;
  assetId: string;
  isExpected: boolean;
  retryCount?: number;
};

type ListTab = "scanned" | "remaining";

type RemainingAsset = {
  id: string;
  name: string;
  thumbnailImage: string | null;
  mainImage: string | null;
};

// ── Error Boundary ───────────────────────────────────────

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
      <TouchableOpacity style={styles.primaryButton} onPress={onRetry}>
        <Text style={styles.primaryButtonText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

class AuditScannerErrorBoundary extends React.Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn("[AuditScanner] Error boundary caught:", error.message);
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

// ── Main Export ──────────────────────────────────────────

export default function AuditScanScreen() {
  return (
    <AuditScannerErrorBoundary>
      <AuditScannerContent />
    </AuditScannerErrorBoundary>
  );
}

// ── Scanner Content ─────────────────────────────────────

function AuditScannerContent() {
  const router = useRouter();
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const isFocused = useIsFocused();
  const { currentOrg } = useOrg();
  const { colors } = useTheme();
  const styles = useStyles();
  const [permission, requestPermission] = useCameraPermissions();

  // ── Audit data state ─────────────────────────────────

  const [auditName, setAuditName] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  // O(1) lookup sets
  const expectedAssetIdsRef = useRef(new Set<string>());
  const expectedAssetMapRef = useRef(new Map<string, AuditExpectedAsset>());
  const scannedAssetIdsRef = useRef(new Set<string>());

  // Counters (optimistic)
  const [foundCount, setFoundCount] = useState(0);
  const [unexpectedCount, setUnexpectedCount] = useState(0);
  const [expectedTotal, setExpectedTotal] = useState(0);

  // Scanned items list (most recent first)
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);

  // ── Camera state ─────────────────────────────────────

  const [torchEnabled, setTorchEnabled] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);

  // ── Cooldown & inactivity ────────────────────────────

  const lastScanRef = useRef("");
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Frame highlight ──────────────────────────────────

  const [frameHighlight, setFrameHighlight] = useState<ScanResult | null>(null);
  const frameHighlightTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // ── Toast state ──────────────────────────────────────

  const [toast, setToast] = useState<{
    type: ScanResult;
    title: string;
    subtitle: string;
  } | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Scan line animation ──────────────────────────────

  const scanLineAnim = useRef(new Animated.Value(0)).current;

  // ── Progress bar animation ───────────────────────────

  const progressAnim = useRef(new Animated.Value(0)).current;

  // ── Background scan queue ────────────────────────────

  const scanQueueRef = useRef<ScanQueueEntry[]>([]);
  const isProcessingQueueRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Persistence (crash recovery) ───────────────────

  const scannedItemsRef = useRef<ScannedItem[]>([]);
  const debouncedSaverRef = useRef<ReturnType<
    typeof createDebouncedSaver
  > | null>(null);

  // ── List tab toggle (scanned / remaining) ──────────

  const [activeTab, setActiveTab] = useState<ListTab>("scanned");

  // ── Image preview modal ────────────────────────────

  const [previewAsset, setPreviewAsset] = useState<RemainingAsset | null>(null);

  // ── Init: fetch audit data ───────────────────────────

  useEffect(() => {
    if (!auditId || !currentOrg) return;

    (async () => {
      setIsInitializing(true);
      setInitError(null);

      const { data, error } = await api.audit(auditId, currentOrg.id);
      if (error || !data) {
        setInitError(error || "Failed to load audit");
        setIsInitializing(false);
        return;
      }

      setAuditName(data.audit.name);
      setExpectedTotal(data.audit.expectedAssetCount);
      setFoundCount(data.audit.foundAssetCount);
      setUnexpectedCount(data.audit.unexpectedAssetCount);

      // Build O(1) lookup sets
      const expectedIds = new Set<string>();
      const expectedMap = new Map<string, AuditExpectedAsset>();
      for (const asset of data.expectedAssets) {
        expectedIds.add(asset.id);
        expectedMap.set(asset.id, asset);
      }
      expectedAssetIdsRef.current = expectedIds;
      expectedAssetMapRef.current = expectedMap;

      // Restore existing scans from server
      const scannedIds = new Set<string>();
      const restoredItems: ScannedItem[] = [];
      for (const scan of data.existingScans) {
        scannedIds.add(scan.assetId);
        restoredItems.push({
          assetId: scan.assetId,
          name: scan.assetTitle,
          isExpected: scan.isExpected,
          scannedAt: scan.scannedAt,
        });
      }
      scannedAssetIdsRef.current = scannedIds;
      setScannedItems(restoredItems);
      scannedItemsRef.current = restoredItems;

      // Set initial progress
      const progress =
        data.audit.expectedAssetCount > 0
          ? data.audit.foundAssetCount / data.audit.expectedAssetCount
          : 0;
      progressAnim.setValue(Math.min(progress, 1));

      // Initialize debounced saver
      debouncedSaverRef.current = createDebouncedSaver(auditId);

      // ── Crash recovery ───────────────────────────────
      const persisted = await loadAuditScanState(auditId);
      if (persisted && persisted.scannedItems.length > 0) {
        // Find items that were scanned locally but not yet on the server
        const serverScannedIds = new Set(
          data.existingScans.map((s) => s.assetId)
        );
        const recoveredItems = persisted.scannedItems.filter(
          (item) => !serverScannedIds.has(item.assetId)
        );
        const pendingQueue = persisted.pendingQueue || [];

        if (recoveredItems.length > 0 || pendingQueue.length > 0) {
          // Show recovery dialog (don't block init)
          setIsInitializing(false);
          Alert.alert(
            "Resume Previous Session?",
            `Found ${recoveredItems.length} unsynced scan${
              recoveredItems.length !== 1 ? "s" : ""
            } from a previous session.`,
            [
              {
                text: "Discard",
                style: "destructive",
                onPress: () => clearAuditScanState(auditId),
              },
              {
                text: "Resume",
                onPress: () => {
                  // Merge recovered items into state
                  for (const item of recoveredItems) {
                    scannedIds.add(item.assetId);
                  }
                  scannedAssetIdsRef.current = scannedIds;

                  const merged = [...recoveredItems, ...restoredItems];
                  setScannedItems(merged);
                  scannedItemsRef.current = merged;

                  // Requeue pending items for submission
                  if (pendingQueue.length > 0) {
                    scanQueueRef.current = pendingQueue.map((e) => ({
                      ...e,
                      retryCount: 0,
                    }));
                    // processQueue will be called after this callback
                    setTimeout(() => processQueue(), 100);
                  }

                  // Recalculate counters
                  let extraFound = 0;
                  let extraUnexpected = 0;
                  for (const item of recoveredItems) {
                    if (item.isExpected) extraFound++;
                    else extraUnexpected++;
                  }
                  if (extraFound > 0) {
                    setFoundCount((prev) => prev + extraFound);
                    animateProgress(data.audit.foundAssetCount + extraFound);
                  }
                  if (extraUnexpected > 0) {
                    setUnexpectedCount((prev) => prev + extraUnexpected);
                  }

                  announce(
                    `Resumed ${recoveredItems.length} scan${
                      recoveredItems.length !== 1 ? "s" : ""
                    } from previous session`
                  );
                },
              },
            ]
          );
          return; // Skip the setIsInitializing below
        } else {
          // Server already has everything — clear stale state
          clearAuditScanState(auditId);
        }
      }

      setIsInitializing(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId, currentOrg, progressAnim]);

  // ── Scan line animation ──────────────────────────────

  useEffect(() => {
    if (!isFocused || isPaused || isInitializing) return;
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
  }, [isFocused, isPaused, isInitializing, scanLineAnim]);

  // ── Inactivity timer ─────────────────────────────────

  const resetInactivityTimer = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(() => {
      setIsPaused(true);
    }, INACTIVITY_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    if (isFocused && !isPaused && !isInitializing) {
      resetInactivityTimer();
    }
    return () => {
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
    };
  }, [isFocused, isPaused, isInitializing, resetInactivityTimer]);

  // ── Cleanup ──────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
      if (frameHighlightTimer.current)
        clearTimeout(frameHighlightTimer.current);
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      // Normal exit — clear persisted state (crash recovery not needed)
      debouncedSaverRef.current?.cancel();
      if (auditId) clearAuditScanState(auditId);
    };
  }, [auditId]);

  // ── Helpers ──────────────────────────────────────────

  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      if (prev) resetInactivityTimer();
      return !prev;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [resetInactivityTimer]);

  const flashFrame = useCallback((type: ScanResult) => {
    if (frameHighlightTimer.current) clearTimeout(frameHighlightTimer.current);
    setFrameHighlight(type);
    frameHighlightTimer.current = setTimeout(() => {
      setFrameHighlight(null);
    }, 500);
  }, []);

  const showToast = useCallback(
    (type: ScanResult, title: string, subtitle: string) => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ type, title, subtitle });

      // Slide in
      Animated.timing(toastAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: Platform.OS !== "web",
      }).start();

      // Auto-dismiss
      toastTimer.current = setTimeout(() => {
        Animated.timing(toastAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: Platform.OS !== "web",
        }).start(() => setToast(null));
      }, TOAST_DURATION_MS);
    },
    [toastAnim]
  );

  const startCooldown = useCallback(() => {
    if (cooldownRef.current) clearTimeout(cooldownRef.current);
    cooldownRef.current = setTimeout(() => {
      lastScanRef.current = "";
    }, SCAN_COOLDOWN_MS);
  }, []);

  /** Release the processing lock and start the cooldown timer */
  const finalizeScan = useCallback(() => {
    isProcessingRef.current = false;
    setIsProcessing(false);
    startCooldown();
  }, [startCooldown]);

  const animateProgress = useCallback(
    (newFound: number) => {
      if (expectedTotal === 0) return;
      const progress = Math.min(newFound / expectedTotal, 1);
      Animated.timing(progressAnim, {
        toValue: progress,
        duration: 300,
        useNativeDriver: false,
      }).start();
    },
    [expectedTotal, progressAnim]
  );

  // ── Background scan queue processor ──────────────────

  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || !currentOrg) return;
    if (scanQueueRef.current.length === 0) return;

    isProcessingQueueRef.current = true;

    while (scanQueueRef.current.length > 0) {
      const entry = scanQueueRef.current[0];
      try {
        await api.recordAuditScan(currentOrg.id, entry);
        // Success — remove from queue and persist immediately
        scanQueueRef.current.shift();
        saveAuditScanState(
          entry.auditSessionId,
          scannedItemsRef.current,
          scanQueueRef.current
        );
      } catch {
        // Network error — retry with backoff
        const retries = (entry.retryCount ?? 0) + 1;
        if (retries >= MAX_QUEUE_RETRIES) {
          // Max retries reached — skip this item, move to next
          // It stays in persisted queue for recovery on next launch
          scanQueueRef.current.shift();
          if (__DEV__)
            console.warn(
              `[AuditQueue] Giving up on scan after ${MAX_QUEUE_RETRIES} retries:`,
              entry.assetId
            );
        } else {
          // Move to end of queue with incremented retry count
          scanQueueRef.current.shift();
          scanQueueRef.current.push({ ...entry, retryCount: retries });
          // Schedule retry with backoff
          const delay = RETRY_DELAYS[retries - 1] ?? 15_000;
          retryTimerRef.current = setTimeout(() => processQueue(), delay);
        }
        break;
      }
    }

    isProcessingQueueRef.current = false;
  }, [currentOrg]);

  const enqueueScan = useCallback(
    (entry: ScanQueueEntry) => {
      scanQueueRef.current.push(entry);
      processQueue();
    },
    [processQueue]
  );

  // ── Barcode scan handler ─────────────────────────────

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (isProcessingRef.current || data === lastScanRef.current) return;
      if (!auditId || !currentOrg) return;

      isProcessingRef.current = true;
      lastScanRef.current = data;
      setIsProcessing(true);
      resetInactivityTimer();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      try {
        // 1. Resolve code → asset (QR or barcode)
        const qrId = extractQrId(data);
        let codeId: string;
        let codeOrgId: string | null;
        let asset: { id: string; title: string } | null;

        if (qrId) {
          // ── Shelf QR path ──
          const { data: qrData, error } = await api.qr(qrId);
          if (error || !qrData?.qr?.asset) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            showToast(
              "error",
              error ? "Lookup Failed" : "No Asset Linked",
              error || "This QR code is not linked to any asset."
            );
            finalizeScan();
            return;
          }

          codeId = qrId;
          codeOrgId = qrData.qr.organizationId ?? null;
          asset = qrData.qr.asset;
        } else {
          // ── Barcode fallback path ──
          if (!currentOrg.barcodesEnabled) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            showToast(
              "error",
              "Barcode Not Supported",
              "Barcode scanning is not enabled for your workspace."
            );
            finalizeScan();
            return;
          }

          const { data: barcodeData, error: barcodeError } = await api.barcode(
            data,
            currentOrg.id
          );

          if (barcodeError || !barcodeData?.barcode?.asset) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            showToast(
              "error",
              barcodeError ? "Lookup Failed" : "No Asset Linked",
              barcodeError || "This barcode is not linked to any asset."
            );
            finalizeScan();
            return;
          }

          codeId = barcodeData.barcode.id;
          codeOrgId = barcodeData.barcode.organizationId;
          asset = barcodeData.barcode.asset;
        }

        // ── Shared processing (QR and barcode converge here) ──

        // Cross-org check
        if (codeOrgId && codeOrgId !== currentOrg.id) {
          flashFrame("error");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast(
            "error",
            "Different Workspace",
            "This asset belongs to another workspace."
          );
          finalizeScan();
          return;
        }

        // 2. O(1) duplicate check
        if (scannedAssetIdsRef.current.has(asset.id)) {
          flashFrame("duplicate");
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          showToast("duplicate", "Already Scanned", asset.title);
          finalizeScan();
          return;
        }

        // 3. Determine expected vs unexpected
        const isExpected = expectedAssetIdsRef.current.has(asset.id);

        // 4. Optimistic update — instant feedback
        scannedAssetIdsRef.current.add(asset.id);

        const newItem: ScannedItem = {
          assetId: asset.id,
          name: asset.title,
          isExpected,
          scannedAt: new Date().toISOString(),
        };
        setScannedItems((prev) => {
          const next = [newItem, ...prev];
          scannedItemsRef.current = next;
          return next;
        });

        if (isExpected) {
          // Found an expected asset
          const newFound = foundCount + 1;
          setFoundCount(newFound);
          animateProgress(newFound);
          flashFrame("found");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          announce("Asset found");
          showToast(
            "found",
            asset.title,
            `Found · ${newFound}/${expectedTotal}`
          );
        } else {
          // Unexpected asset
          setUnexpectedCount((prev) => prev + 1);
          flashFrame("unexpected");
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          announce("Asset not in audit");
          showToast("unexpected", asset.title, "Unexpected asset");
        }

        // 5. Background persistence — submit to server
        enqueueScan({
          auditSessionId: auditId,
          qrId: codeId,
          assetId: asset.id,
          isExpected,
        });

        // 6. Persist to disk for crash recovery (debounced)
        debouncedSaverRef.current?.save(
          scannedItemsRef.current,
          scanQueueRef.current
        );

        finalizeScan();
      } catch (err) {
        if (__DEV__) console.error("[AuditScanner] Error:", err);
        flashFrame("error");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast("error", "Scan Error", "Something went wrong.");
        finalizeScan();
      }
    },
    [
      auditId,
      currentOrg,
      foundCount,
      expectedTotal,
      flashFrame,
      showToast,
      startCooldown,
      resetInactivityTimer,
      animateProgress,
      enqueueScan,
    ]
  );

  // ── Complete audit ───────────────────────────────────

  const handleComplete = useCallback(() => {
    if (!auditId || !currentOrg) return;

    const remaining = expectedTotal - foundCount;

    Alert.alert(
      "Complete Audit",
      remaining > 0
        ? `Complete "${auditName}"?\n\n${remaining} unscanned ${
            remaining === 1 ? "asset" : "assets"
          } will be marked as missing.`
        : `Complete "${auditName}"?\n\nAll expected assets have been found.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Complete",
          onPress: async () => {
            // Clear crash recovery state — audit is being completed
            debouncedSaverRef.current?.cancel();
            await clearAuditScanState(auditId);

            const timeZone = (() => {
              try {
                return (
                  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
                );
              } catch {
                return "UTC";
              }
            })();

            const { error: err } = await api.completeAudit(currentOrg.id, {
              sessionId: auditId,
              timeZone,
            });

            if (err) {
              Alert.alert("Error", err);
              return;
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
              "Audit Complete",
              `"${auditName}" has been completed.`,
              [{ text: "OK", onPress: () => router.back() }]
            );
          },
        },
      ]
    );
  }, [auditId, currentOrg, auditName, expectedTotal, foundCount, router]);

  // ── Render scanned item ──────────────────────────────

  const renderScannedItem = useCallback(
    ({ item }: { item: ScannedItem }) => (
      <View style={styles.scannedItem}>
        <Ionicons
          name={item.isExpected ? "checkmark-circle" : "alert-circle"}
          size={18}
          color={item.isExpected ? colors.success : colors.warning}
        />
        <Text style={styles.scannedItemName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.scannedItemBadge}>
          {item.isExpected ? "Found" : "Unexpected"}
        </Text>
      </View>
    ),
    [colors, styles]
  );

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: SCANNED_ITEM_HEIGHT,
      offset: SCANNED_ITEM_HEIGHT * index,
      index,
    }),
    []
  );

  // ── Remaining assets (expected but not yet scanned) ──

  const remainingCount = expectedTotal - foundCount;

  const remainingAssets = useMemo<RemainingAsset[]>(() => {
    if (activeTab !== "remaining") return []; // skip when hidden
    const result: RemainingAsset[] = [];
    for (const [assetId, asset] of expectedAssetMapRef.current) {
      if (!scannedAssetIdsRef.current.has(assetId)) {
        result.push({
          id: assetId,
          name: asset.name,
          thumbnailImage: asset.thumbnailImage || asset.mainImage,
          mainImage: asset.mainImage,
        });
      }
    }
    return result;
  }, [activeTab, scannedItems]); // scannedItems triggers recalc

  const handlePreviewImage = useCallback((item: RemainingAsset) => {
    const imageUri = item.mainImage || item.thumbnailImage;
    if (imageUri) {
      setPreviewAsset(item);
    }
  }, []);

  const renderRemainingItem = useCallback(
    ({ item }: { item: RemainingAsset }) => {
      const hasImage = !!(item.mainImage || item.thumbnailImage);
      return (
        <View style={styles.remainingItem}>
          {item.thumbnailImage ? (
            <TouchableOpacity
              onPress={() => handlePreviewImage(item)}
              activeOpacity={0.7}
              accessibilityLabel={`View larger image of ${item.name}`}
              accessibilityRole="imagebutton"
            >
              <Image
                source={{ uri: item.thumbnailImage }}
                style={styles.remainingImage}
                contentFit="cover"
              />
              {hasImage && (
                <View style={styles.remainingImageZoomBadge}>
                  <Ionicons name="expand-outline" size={10} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          ) : (
            <View
              style={[styles.remainingImage, styles.remainingImagePlaceholder]}
            >
              <Ionicons name="cube-outline" size={16} color={colors.gray300} />
            </View>
          )}
          <Text style={styles.remainingItemName} numberOfLines={1}>
            {item.name}
          </Text>
        </View>
      );
    },
    [colors, styles, handlePreviewImage]
  );

  const getRemainingItemLayout = useCallback(
    (_: any, index: number) => ({
      length: REMAINING_ITEM_HEIGHT,
      offset: REMAINING_ITEM_HEIGHT * index,
      index,
    }),
    []
  );

  // ── Permission states ────────────────────────────────

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
          Shelf needs camera access to scan assets for this audit.
        </Text>
        {permission.canAskAgain ? (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={requestPermission}
          >
            <Text style={styles.primaryButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => {
              if (Platform.OS === "ios") {
                Linking.openURL("app-settings:");
              } else {
                Linking.openSettings();
              }
            }}
          >
            <Text style={styles.primaryButtonText}>Open Settings</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── Initializing state ───────────────────────────────

  if (isInitializing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.messageBody}>Loading audit data...</Text>
      </View>
    );
  }

  if (initError) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        <Text style={styles.messageTitle}>Failed to Load</Text>
        <Text style={styles.messageBody}>{initError}</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.back()}
        >
          <Text style={styles.primaryButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Computed values ──────────────────────────────────

  const progressPercent =
    expectedTotal > 0
      ? Math.round(Math.min(foundCount / expectedTotal, 1) * 100)
      : 0;

  const scanLineTranslate = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 200],
  });

  const frameColor =
    frameHighlight === "found"
      ? "#4CAF50"
      : frameHighlight === "unexpected"
      ? "#FF9800"
      : frameHighlight === "duplicate"
      ? "#FFC107"
      : frameHighlight === "error"
      ? "#F04438"
      : "#fff";

  // ── Camera view ──────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Top 60%: Camera */}
      <View style={styles.cameraSection}>
        {isFocused && !isPaused && (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torchEnabled}
            barcodeScannerSettings={{
              barcodeTypes: ["qr", "code128", "code39", "datamatrix", "ean13"],
            }}
            onBarcodeScanned={isProcessing ? undefined : handleBarCodeScanned}
          />
        )}

        {/* Paused overlay */}
        {isPaused && (
          <TouchableOpacity
            style={styles.pausedOverlay}
            onPress={togglePause}
            activeOpacity={0.9}
            accessibilityLabel="Camera paused. Tap to resume"
            accessibilityRole="button"
          >
            <Ionicons
              name="play-circle-outline"
              size={64}
              color="rgba(255,255,255,0.8)"
            />
            <Text style={styles.pausedTitle}>Camera Paused</Text>
            <Text style={styles.pausedSubtitle}>Tap to resume</Text>
          </TouchableOpacity>
        )}

        {/* Overlay with frame */}
        <View style={[styles.cameraOverlay, { pointerEvents: "box-none" }]}>
          {/* Header: back + audit name + controls */}
          <View style={styles.cameraHeader}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.headerBackButton}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerInfo}>
              <Text style={styles.headerLabel}>Audit Scanner</Text>
              <Text style={styles.headerName} numberOfLines={1}>
                {auditName}
              </Text>
            </View>
            <View style={styles.controlButtons}>
              <TouchableOpacity
                style={[
                  styles.controlButton,
                  isPaused && styles.controlButtonActive,
                ]}
                onPress={togglePause}
                accessibilityLabel={isPaused ? "Resume camera" : "Pause camera"}
                accessibilityRole="button"
              >
                <Ionicons
                  name={isPaused ? "play" : "pause"}
                  size={18}
                  color="#fff"
                />
              </TouchableOpacity>
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
              >
                <Ionicons
                  name={torchEnabled ? "flash" : "flash-outline"}
                  size={18}
                  color={torchEnabled ? "#FFD600" : "#fff"}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Scan frame */}
          <View style={styles.scanFrameContainer}>
            <View style={styles.scanFrame}>
              <View
                style={[
                  styles.corner,
                  styles.cornerTL,
                  frameHighlight && { borderColor: frameColor },
                ]}
              />
              <View
                style={[
                  styles.corner,
                  styles.cornerTR,
                  frameHighlight && { borderColor: frameColor },
                ]}
              />
              <View
                style={[
                  styles.corner,
                  styles.cornerBL,
                  frameHighlight && { borderColor: frameColor },
                ]}
              />
              <View
                style={[
                  styles.corner,
                  styles.cornerBR,
                  frameHighlight && { borderColor: frameColor },
                ]}
              />
              {!isPaused && !frameHighlight && (
                <Animated.View
                  style={[
                    styles.scanLine,
                    {
                      transform: [{ translateY: scanLineTranslate }],
                    },
                  ]}
                />
              )}
            </View>
          </View>

          {/* Processing indicator */}
          {isProcessing && (
            <View style={styles.processingRow}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.processingText}>Looking up asset...</Text>
            </View>
          )}
        </View>

        {/* Toast overlay */}
        {toast && (
          <Animated.View
            style={[
              styles.toast,
              toast.type === "found" && styles.toastFound,
              toast.type === "unexpected" && styles.toastUnexpected,
              toast.type === "duplicate" && styles.toastDuplicate,
              toast.type === "error" && styles.toastError,
              {
                transform: [
                  {
                    translateY: toastAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-60, 0],
                    }),
                  },
                ],
                opacity: toastAnim,
              },
            ]}
          >
            <Ionicons
              name={
                toast.type === "found"
                  ? "checkmark-circle"
                  : toast.type === "unexpected"
                  ? "alert-circle"
                  : toast.type === "duplicate"
                  ? "copy-outline"
                  : "close-circle"
              }
              size={20}
              color="#fff"
            />
            <View style={styles.toastText}>
              <Text style={styles.toastTitle} numberOfLines={1}>
                {toast.title}
              </Text>
              <Text style={styles.toastSubtitle} numberOfLines={1}>
                {toast.subtitle}
              </Text>
            </View>
          </Animated.View>
        )}
      </View>

      {/* Bottom 40%: Progress + scanned list */}
      <View style={styles.bottomPanel}>
        {/* Progress bar */}
        <View style={styles.progressSection}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>
              {foundCount}/{expectedTotal} found
            </Text>
            {unexpectedCount > 0 && (
              <Text style={styles.progressUnexpected}>
                +{unexpectedCount} unexpected
              </Text>
            )}
            <Text style={styles.progressPercent}>{progressPercent}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0%", "100%"],
                  }),
                  backgroundColor:
                    progressPercent === 100 ? colors.success : colors.primary,
                },
              ]}
            />
          </View>
        </View>

        {/* Scanned / Remaining toggle + list */}
        <View style={styles.scannedListSection}>
          {/* Segmented control */}
          <View style={styles.segmentedControl} accessibilityRole="tablist">
            <TouchableOpacity
              style={[
                styles.segmentedOption,
                activeTab === "scanned" && styles.segmentedOptionActive,
              ]}
              onPress={() => setActiveTab("scanned")}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === "scanned" }}
              accessibilityLabel={`Scanned ${scannedItems.length}`}
            >
              <Text
                style={[
                  styles.segmentedOptionText,
                  activeTab === "scanned" && styles.segmentedOptionTextActive,
                ]}
              >
                Scanned ({scannedItems.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.segmentedOption,
                activeTab === "remaining" && styles.segmentedOptionActive,
              ]}
              onPress={() => setActiveTab("remaining")}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === "remaining" }}
              accessibilityLabel={`Remaining ${remainingCount}`}
            >
              <Text
                style={[
                  styles.segmentedOptionText,
                  activeTab === "remaining" && styles.segmentedOptionTextActive,
                ]}
              >
                Remaining ({remainingCount})
              </Text>
            </TouchableOpacity>
          </View>

          {/* List content */}
          {activeTab === "scanned" ? (
            scannedItems.length === 0 ? (
              <View style={styles.scannedListEmpty}>
                <Ionicons name="scan-outline" size={24} color={colors.border} />
                <Text style={styles.scannedListEmptyText}>
                  Scan a code to begin
                </Text>
              </View>
            ) : (
              <FlatList
                data={scannedItems}
                renderItem={renderScannedItem}
                keyExtractor={scanKeyExtractor}
                getItemLayout={getItemLayout}
                removeClippedSubviews
                maxToRenderPerBatch={10}
                windowSize={5}
                initialNumToRender={10}
                style={styles.scannedList}
                showsVerticalScrollIndicator={false}
              />
            )
          ) : remainingAssets.length === 0 ? (
            <View style={styles.scannedListEmpty}>
              <Ionicons
                name="checkmark-done-outline"
                size={24}
                color={colors.success}
              />
              <Text style={styles.scannedListEmptyText}>
                All expected assets found!
              </Text>
            </View>
          ) : (
            <FlatList
              data={remainingAssets}
              renderItem={renderRemainingItem}
              keyExtractor={remainingKeyExtractor}
              getItemLayout={getRemainingItemLayout}
              removeClippedSubviews
              maxToRenderPerBatch={10}
              windowSize={5}
              initialNumToRender={10}
              style={styles.scannedList}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>

        {/* Complete button */}
        {scannedItems.length > 0 && (
          <TouchableOpacity
            style={styles.completeButton}
            onPress={handleComplete}
            accessibilityLabel="Complete audit"
            accessibilityRole="button"
          >
            <Ionicons
              name="checkmark-done-outline"
              size={18}
              color={colors.primaryForeground}
            />
            <Text style={styles.completeButtonText}>Complete Audit</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Image Preview Modal ─────────────────────────── */}
      <Modal
        visible={!!previewAsset}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewAsset(null)}
      >
        <TouchableOpacity
          style={styles.previewOverlay}
          activeOpacity={1}
          onPress={() => setPreviewAsset(null)}
          accessibilityViewIsModal={true}
          accessibilityLabel="Close image preview"
        >
          <TouchableOpacity
            style={styles.previewCloseBtn}
            onPress={() => setPreviewAsset(null)}
            accessibilityLabel="Close"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>

          {previewAsset && (
            <View
              style={styles.previewContent}
              onStartShouldSetResponder={() => true}
            >
              <Image
                source={{
                  uri:
                    previewAsset.mainImage || previewAsset.thumbnailImage || "",
                }}
                style={styles.previewImage}
                contentFit="contain"
              />
              <Text style={styles.previewAssetName} numberOfLines={2}>
                {previewAsset.name}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.backgroundSecondary,
    gap: spacing.md,
    padding: spacing.xxl,
  },

  // Messages
  messageTitle: {
    fontSize: fontSize.xl,
    fontWeight: "700",
    color: colors.foreground,
    textAlign: "center",
  },
  messageBody: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: spacing.xxl,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 12,
    borderRadius: borderRadius.md,
    marginTop: spacing.sm,
  },
  primaryButtonText: {
    color: colors.primaryForeground,
    fontWeight: "600",
    fontSize: fontSize.md,
  },

  // Camera section (top 60%)
  cameraSection: {
    flex: 6,
    backgroundColor: "#000",
    position: "relative",
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
  },

  // Camera header
  cameraHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  headerBackButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerInfo: {
    flex: 1,
  },
  headerLabel: {
    fontSize: fontSize.xs,
    color: "rgba(255,255,255,0.7)",
    fontWeight: "500",
  },
  headerName: {
    fontSize: fontSize.md,
    color: "#fff",
    fontWeight: "600",
  },
  controlButtons: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  controlButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  controlButtonActive: {
    backgroundColor: "rgba(255,255,255,0.2)",
  },

  // Scan frame
  scanFrameContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scanFrame: {
    width: 220,
    height: 220,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: 30,
    height: 30,
    borderColor: "#fff",
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 4,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 4,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 4,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 4,
  },
  scanLine: {
    position: "absolute",
    left: 10,
    right: 10,
    height: 2,
    backgroundColor: "rgba(99,178,239,0.6)",
    borderRadius: 1,
  },

  // Processing indicator
  processingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  processingText: {
    fontSize: fontSize.sm,
    color: "#fff",
    fontWeight: "500",
  },

  // Paused overlay
  pausedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
    zIndex: 10,
  },
  pausedTitle: {
    fontSize: fontSize.xl,
    fontWeight: "700",
    color: "#fff",
  },
  pausedSubtitle: {
    fontSize: fontSize.base,
    color: "rgba(255,255,255,0.7)",
  },

  // Toast
  toast: {
    position: "absolute",
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    zIndex: 20,
  },
  toastFound: {
    backgroundColor: "rgba(22,163,74,0.9)",
  },
  toastUnexpected: {
    backgroundColor: "rgba(245,158,11,0.9)",
  },
  toastDuplicate: {
    backgroundColor: "rgba(161,98,7,0.9)",
  },
  toastError: {
    backgroundColor: "rgba(239,68,68,0.9)",
  },
  toastText: {
    flex: 1,
  },
  toastTitle: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: "#fff",
  },
  toastSubtitle: {
    fontSize: fontSize.xs,
    color: "rgba(255,255,255,0.8)",
  },

  // Bottom panel (40%)
  bottomPanel: {
    flex: 4,
    backgroundColor: colors.backgroundSecondary,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    marginTop: -12,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },

  // Progress section
  progressSection: {
    gap: spacing.xs,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  progressLabel: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
  },
  progressUnexpected: {
    fontSize: fontSize.xs,
    color: colors.warning,
    fontWeight: "500",
  },
  progressPercent: {
    fontSize: fontSize.sm,
    fontWeight: "700",
    color: colors.primary,
    marginLeft: "auto",
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.borderLight,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },

  // Scanned items list
  scannedListSection: {
    flex: 1,
    gap: spacing.xs,
  },
  scannedListTitle: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
  },
  scannedList: {
    flex: 1,
  },
  scannedListEmpty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
  },
  scannedListEmptyText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  scannedItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    height: SCANNED_ITEM_HEIGHT,
  },
  scannedItemName: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.foreground,
  },
  scannedItemBadge: {
    fontSize: fontSize.xs,
    fontWeight: "500",
    color: colors.muted,
  },

  // Segmented control
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: colors.borderLight,
    borderRadius: borderRadius.md,
    padding: 2,
    gap: 2,
  },
  segmentedOption: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: borderRadius.sm,
  },
  segmentedOptionActive: {
    backgroundColor: colors.primary,
  },
  segmentedOptionText: {
    fontSize: fontSize.sm,
    fontWeight: "600" as const,
    color: colors.muted,
  },
  segmentedOptionTextActive: {
    color: colors.primaryForeground,
  },

  // Remaining items
  remainingItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    height: REMAINING_ITEM_HEIGHT,
  },
  remainingImage: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
  },
  remainingImagePlaceholder: {
    backgroundColor: colors.backgroundTertiary,
    justifyContent: "center",
    alignItems: "center",
  },
  remainingItemName: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: "500" as const,
    color: colors.foreground,
  },
  remainingImageZoomBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },

  // Image preview modal
  previewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center",
    alignItems: "center",
  },
  previewCloseBtn: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  previewContent: {
    alignItems: "center",
    gap: spacing.md,
  },
  previewImage: {
    width: Dimensions.get("window").width - 40,
    height: Dimensions.get("window").height * 0.55,
  },
  previewAssetName: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
    paddingHorizontal: spacing.xxl,
  },

  // Complete button
  completeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
    marginBottom: Platform.OS === "ios" ? spacing.xxxl : spacing.lg,
    ...shadows.sm,
  },
  completeButtonText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.primaryForeground,
  },
}));
