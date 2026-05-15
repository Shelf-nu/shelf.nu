import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Linking,
  Platform,
  Alert,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { extractQrId } from "@/lib/qr-utils";
import { announce } from "@/lib/a11y";
import { playScanSound } from "@/lib/scan-sound";
import { clearAuditScanState } from "@/lib/audit-scan-persistence";
import { ScannerErrorBoundary } from "@/components/scanner-error-boundary";
import { useScanLineAnimation } from "@/hooks/use-scan-line-animation";
import { useInactivityTimer } from "@/hooks/use-inactivity-timer";
import { useScanCooldown } from "@/hooks/use-scan-cooldown";
import { useAuditInit } from "@/hooks/use-audit-init";
import { useScanQueue } from "@/hooks/use-scan-queue";
import {
  useToastNotification,
  type ScanResult,
} from "@/hooks/use-toast-notification";
import { ProgressHeader } from "@/components/audit/progress-header";
import { ScannedItemsList } from "@/components/audit/scanned-items-list";
import {
  RemainingAssetsList,
  type RemainingAsset,
} from "@/components/audit/remaining-assets-list";
import {
  SegmentedControl,
  type ListTab,
} from "@/components/audit/segmented-control";

// ── Main Export ──────────────────────────────────────────

export default function AuditScanScreen() {
  return (
    <ScannerErrorBoundary label="AuditScanner">
      <AuditScannerContent />
    </ScannerErrorBoundary>
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

  // ── Camera state ─────────────────────────────────────

  const [torchEnabled, setTorchEnabled] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);

  // ── Cooldown (shared hook) ───────────────────────────

  const {
    shouldSkip: shouldSkipScan,
    startCooldown,
    lastScanRef,
  } = useScanCooldown();

  // Dev-mode scan injection (stripped from production builds)
  const [devScanInput, setDevScanInput] = useState("");
  const [devScanVisible, setDevScanVisible] = useState(false);

  // ── Frame highlight ──────────────────────────────────

  const [frameHighlight, setFrameHighlight] = useState<ScanResult | null>(null);
  const frameHighlightTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // ── Toast (extracted hook) ───────────────────────────

  const { toast, toastAnim, toastTimerRef, showToast } = useToastNotification();

  // ── Progress bar animation ───────────────────────────

  const progressAnim = useRef(new Animated.Value(0)).current;

  // ── Scan line animation (shared hook) ───────────────

  const animateProgress = useCallback(
    (newFound: number) => {
      // Need expectedTotal, but it's from auditInit — we'll use a ref
      const total = expectedTotalRef.current;
      if (total === 0) return;
      const progress = Math.min(newFound / total, 1);
      Animated.timing(progressAnim, {
        toValue: progress,
        duration: 300,
        useNativeDriver: false,
      }).start();
    },
    [progressAnim]
  );

  // ── Background scan queue (extracted hook) ──────────

  // We need scannedItemsRef before calling useScanQueue, but useAuditInit
  // provides it. We solve this by creating a stable ref that useAuditInit
  // populates. useScanQueue only reads .current at call time, so this works.
  const stableScannedItemsRef = useRef<
    { assetId: string; name: string; isExpected: boolean; scannedAt: string }[]
  >([]);

  const { scanQueueRef, enqueueScan, processQueue, retryTimerRef } =
    useScanQueue({
      orgId: currentOrg?.id,
      scannedItemsRef: stableScannedItemsRef,
    });

  // ── Audit init (extracted hook) ─────────────────────

  const {
    auditName,
    isInitializing,
    initError,
    expectedAssetIdsRef,
    expectedAssetMapRef,
    scannedAssetIdsRef,
    foundCount,
    setFoundCount,
    unexpectedCount,
    setUnexpectedCount,
    expectedTotal,
    scannedItems,
    setScannedItems,
    scannedItemsRef,
    debouncedSaverRef,
  } = useAuditInit({
    auditId,
    orgId: currentOrg?.id,
    progressAnim,
    animateProgress,
    processQueue,
    scanQueueRef,
  });

  // Keep the stable ref in sync with the audit init ref
  stableScannedItemsRef.current = scannedItemsRef.current;

  // Track expectedTotal in a ref for animateProgress
  const expectedTotalRef = useRef(expectedTotal);
  expectedTotalRef.current = expectedTotal;

  const scanLineAnim = useScanLineAnimation(
    isFocused,
    isPaused,
    !isInitializing
  );

  // ── List tab toggle (scanned / remaining) ──────────

  const [activeTab, setActiveTab] = useState<ListTab>("scanned");

  // ── Inactivity timer (shared hook) ──────────────────

  const onInactivityTimeout = useCallback(() => setIsPaused(true), []);
  const { resetTimer: resetInactivityTimer } = useInactivityTimer({
    isFocused,
    isPaused,
    onTimeout: onInactivityTimeout,
    extraConditions: [!isInitializing],
  });

  // ── Cleanup ──────────────────────────────────────────

  useEffect(() => {
    return () => {
      // why: reads .current at unmount time intentionally — we want to clear whatever
      // timer is currently active, not whatever was active at effect setup
      /* eslint-disable react-hooks/exhaustive-deps */
      if (frameHighlightTimer.current)
        clearTimeout(frameHighlightTimer.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      // Normal exit — clear persisted state (crash recovery not needed)
      debouncedSaverRef.current?.cancel();
      /* eslint-enable react-hooks/exhaustive-deps */
      if (auditId) clearAuditScanState(auditId);
    };
  }, [auditId, toastTimerRef, retryTimerRef, debouncedSaverRef]);

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

  /** Release the processing lock and start the cooldown timer */
  const finalizeScan = useCallback(() => {
    isProcessingRef.current = false;
    setIsProcessing(false);
    startCooldown();
  }, [startCooldown]);

  // ── Barcode scan handler ─────────────────────────────

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (isProcessingRef.current || shouldSkipScan(data)) return;
      if (!auditId || !currentOrg) return;

      isProcessingRef.current = true;
      lastScanRef.current = data;
      setIsProcessing(true);
      resetInactivityTimer();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      try {
        // 1. Resolve code -> asset (QR or barcode)
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

        const newItem = {
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
          playScanSound();
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
      resetInactivityTimer,
      animateProgress,
      enqueueScan,
      finalizeScan,
      scannedAssetIdsRef,
      expectedAssetIdsRef,
      setScannedItems,
      scannedItemsRef,
      setFoundCount,
      setUnexpectedCount,
      debouncedSaverRef,
      scanQueueRef,
      shouldSkipScan,
      lastScanRef,
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
            playScanSound();
            Alert.alert(
              "Audit Complete",
              `"${auditName}" has been completed.`,
              [{ text: "OK", onPress: () => router.back() }]
            );
          },
        },
      ]
    );
  }, [
    auditId,
    currentOrg,
    auditName,
    expectedTotal,
    foundCount,
    router,
    debouncedSaverRef,
  ]);

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
          locationName: asset.locationName,
          categoryName: asset.categoryName,
        });
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, scannedItems]); // scannedItems triggers recalc

  // ── Permission states ────────────────────────────────

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.muted} />
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
        <ActivityIndicator size="large" color={colors.muted} />
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

      {/* ── Dev Scan Injection (DEV only) ───────────── */}
      {__DEV__ && (
        <View style={styles.devScanContainer}>
          {devScanVisible ? (
            <View style={styles.devScanRow}>
              <TextInput
                testID="dev-scan-input"
                style={styles.devScanInput}
                value={devScanInput}
                onChangeText={setDevScanInput}
                placeholder="QR ID or barcode value"
                placeholderTextColor="rgba(255,255,255,0.4)"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={() => {
                  if (devScanInput.trim()) {
                    handleBarCodeScanned({ data: devScanInput.trim() });
                    setDevScanInput("");
                  }
                }}
              />
              <TouchableOpacity
                testID="dev-scan-submit"
                style={styles.devScanButton}
                onPress={() => {
                  if (devScanInput.trim()) {
                    handleBarCodeScanned({ data: devScanInput.trim() });
                    setDevScanInput("");
                  }
                }}
                accessibilityLabel="Inject scan"
              >
                <Ionicons name="scan" size={16} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.devScanClose}
                onPress={() => setDevScanVisible(false)}
                accessibilityLabel="Close dev scanner"
              >
                <Ionicons name="close" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              testID="dev-scan-toggle"
              style={styles.devScanToggle}
              onPress={() => setDevScanVisible(true)}
              accessibilityLabel="Open dev scanner input"
            >
              <Ionicons name="code-working-outline" size={14} color="#fff" />
              <Text style={styles.devScanToggleText}>DEV SCAN</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Bottom 40%: Progress + scanned list */}
      <View style={styles.bottomPanel}>
        <ProgressHeader
          foundCount={foundCount}
          expectedCount={expectedTotal}
          unexpectedCount={unexpectedCount}
          progressAnim={progressAnim}
          progressPercent={progressPercent}
        />

        {/* Scanned / Remaining toggle + list */}
        <View style={styles.scannedListSection}>
          <SegmentedControl
            activeTab={activeTab}
            onTabChange={setActiveTab}
            scannedCount={scannedItems.length}
            remainingCount={remainingCount}
          />

          {/* List content */}
          {activeTab === "scanned" ? (
            <ScannedItemsList items={scannedItems} />
          ) : (
            <RemainingAssetsList items={remainingAssets} />
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

  // Scanned items list
  scannedListSection: {
    flex: 1,
    gap: spacing.xs,
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

  // ── Dev Scan Injection (DEV only) ───────────────
  devScanContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    zIndex: 999,
  },
  devScanRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: borderRadius.md,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  devScanInput: {
    flex: 1,
    color: "#fff",
    fontSize: fontSize.sm,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  devScanButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
  },
  devScanClose: {
    padding: spacing.xs,
  },
  devScanToggle: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    alignSelf: "center" as const,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: 4,
  },
  devScanToggleText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 1,
  },
}));
