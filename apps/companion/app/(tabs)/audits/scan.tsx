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
  AppState,
  useWindowDimensions,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter, useLocalSearchParams, useIsFocused } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { api, type AuditExpectedAsset } from "@/lib/api";
import { reportAuditDurabilityEvent } from "@/lib/sentry";
import { useOrg } from "@/lib/org-context";
import { useAuth } from "@/lib/auth-context";
import { queueThenRecord } from "@/lib/scan-queue-owner";
import { draftActionOnClose } from "@/lib/audit-scan-persistence";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { scanSplit } from "@/lib/safe-edges";
import {
  useOverlayEdges,
  useTabScreenInsets,
  useTabScreenWidth,
} from "@/lib/use-safe-edges";
import { createStyles } from "@/lib/create-styles";
import { classifyScannedCode, extractQrId } from "@/lib/qr-utils";
import { getActiveServer } from "@/lib/server";
import { parseSequentialId } from "@/lib/sequential-id";
import { announce } from "@/lib/a11y";
import { maybeAskForReview } from "@/lib/review-prompt";
import { playScanSound } from "@/lib/scan-sound";
import { ScannerErrorBoundary } from "@/components/scanner-error-boundary";
import { useScanLineAnimation } from "@/hooks/use-scan-line-animation";
import { useInactivityTimer } from "@/hooks/use-inactivity-timer";
import { useScanCooldown } from "@/hooks/use-scan-cooldown";
import { endScan, tryBeginScan } from "@/lib/scan-lock";
import { useAuditInit } from "@/hooks/use-audit-init";
import { useScanQueue } from "@/hooks/use-scan-queue";
import { useCameraScanHandler } from "@/hooks/use-camera-scan-handler";
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
import { CompleteAuditSheet } from "@/components/audit/complete-audit-sheet";
import { QuantityInputSheet } from "@/components/quantity-input-sheet";
import type { PendingRecount } from "@/lib/audit-scan-queue";
import {
  auditScanDecision,
  countExpectation,
  countSheetDefault,
  recountAnswerToast,
  recountQueueEntry,
  MAX_AUDIT_COUNT,
} from "@/lib/audit-scan-queue";
import { EvidenceModal } from "@/components/audit/evidence-modal";
import { EvidenceCoachmark } from "@/components/audit/evidence-coachmark";
import type { ScannedItem } from "@/hooks/use-audit-init";

// ── Main Export ──────────────────────────────────────────

/** The count the sheet is asking for. See `countRequest` in the screen. */
type AuditCountRequest = {
  mode: "first" | "recount";
  assetId: string;
  assetTitle: string;
  /** The scanned code, sent with the recorded scan. */
  codeId: string;
  isExpected: boolean;
  expectedQuantity: number;
  /** The count already recorded; null on a first scan. */
  foundQuantity: number | null;
  unitOfMeasure: string | null;
};

/**
 * Shown when the scan queue refuses a scan (nobody, or another account than
 * the one this audit session started with, is signed in): the scan was not
 * recorded and must be scanned again once signed in.
 */
const SCAN_NOT_RECORDED = "Not recorded. Sign in again, then rescan.";

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
  // Unsynced scan drafts are saved and recovered per account.
  const userId = useAuth().user?.id;
  const { colors } = useTheme();
  const styles = useStyles();
  const [permission, requestPermission] = useCameraPermissions();

  // ── Layout ───────────────────────────────────────────

  /**
   * The screen's own width: beside the tab sidebar it is narrower than the
   * window. Seeded before the first layout, so a wide screen opens straight
   * into the side-by-side layout.
   */
  const { width: screenWidth, onLayout: onScreenLayout } = useTabScreenWidth();
  /**
   * Height to weigh it against: the window's, which the keyboard never
   * changes. The screen's measured height shrinks while the Android keyboard
   * is up, and judging by it would move the list beside the camera, and back,
   * while a code is being typed. Above a bottom tab bar the screen is a little
   * shorter than the window, so a near-square screen stays stacked, the
   * phone layout.
   */
  const { height: screenHeight } = useWindowDimensions();
  /**
   * Whether the list sits beside the camera, and which insets each part keeps
   * clear of: an iPhone Duo's status-bar rail or a turned foldable's camera
   * cutout, each side on its own. The tab sidebar already covers the left one
   * when it is showing.
   */
  const split = scanSplit(
    { width: screenWidth, height: screenHeight },
    useTabScreenInsets()
  );
  const { sideBySide } = split;
  const cameraEdges = useOverlayEdges(split.camera);

  // ── Camera state ─────────────────────────────────────

  const [torchEnabled, setTorchEnabled] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);

  // The count sheet for a quantity-tracked asset: open on its first scan
  // ("first", the scan is recorded on confirm) and on a re-scan ("recount",
  // the count is replaced). Scanning stays paused while it is open.
  const [countRequest, setCountRequest] = useState<AuditCountRequest | null>(
    null
  );
  // What the open sheet can promise: a target only when units are expected.
  const countExpectationValue = countRequest
    ? countExpectation(countRequest)
    : null;
  // Records the first scan once its count is confirmed.
  const pendingCommitRef = useRef<((foundQuantity: number) => void) | null>(
    null
  );

  // ── Cooldown (shared hook) ───────────────────────────

  const { startCooldown, lastScanRef } = useScanCooldown();

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

  // Ref to hold setScannedItems - populated after useAuditInit
  const setScannedItemsRef = useRef<React.Dispatch<
    React.SetStateAction<ScannedItem[]>
  > | null>(null);

  // Ref to hold setSelectedItem - used by handleScanSynced
  const setSelectedItemRef = useRef<React.Dispatch<
    React.SetStateAction<ScannedItem | null>
  > | null>(null);

  // Recounts confirmed on this device and not answered yet, by asset. The
  // result toast waits for the server: a finished audit keeps its count.
  const pendingRecountsRef = useRef(new Map<string, PendingRecount>());

  // The queue keeps sending after this screen closes; its answers then update
  // the rows only, with no haptic or toast over whatever screen is open.
  const screenOpenRef = useRef(true);
  useEffect(() => {
    screenOpenRef.current = true;
    return () => {
      screenOpenRef.current = false;
    };
  }, []);

  // Callback for when scan is synced - updates React state with auditAssetId
  const handleScanSynced = useCallback(
    (
      assetId: string,
      auditAssetId: string | null,
      storedCount?: number | null,
      countRefused?: boolean
    ) => {
      // Update the scanned items list (clear any prior sync-failed marker).
      // The count the server stored, when given, replaces the local one.
      setScannedItemsRef.current?.((prev) =>
        prev.map((item) =>
          item.assetId === assetId
            ? {
                ...item,
                ...(auditAssetId ? { auditAssetId } : {}),
                syncFailed: false,
                ...(storedCount !== undefined
                  ? { foundQuantity: storedCount }
                  : {}),
              }
            : item
        )
      );
      // Also update selectedItem if evidence modal is open for this asset
      setSelectedItemRef.current?.((prev) =>
        prev?.assetId === assetId && auditAssetId
          ? { ...prev, auditAssetId }
          : prev
      );
      if (!screenOpenRef.current) {
        pendingRecountsRef.current.delete(assetId);
        return;
      }
      // A recount from this device: report what the server stored.
      const pending = pendingRecountsRef.current.get(assetId);
      const recountToast = pending
        ? recountAnswerToast(pending, storedCount)
        : null;
      if (pending && recountToast) {
        pendingRecountsRef.current.delete(assetId);
        Haptics.notificationAsync(
          recountToast.type === "found"
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Error
        );
        showToast(recountToast.type, recountToast.title, recountToast.subtitle);
        return;
      }
      // The count the auditor entered did not stick: say so, since the row
      // has just changed back under them.
      if (countRefused) {
        const name =
          stableScannedItemsRef.current
            .find((item) => item.assetId === assetId)
            ?.name?.trim() || "Count not saved";
        showToast(
          "error",
          name,
          storedCount === null || storedCount === undefined
            ? "Count not saved: the scan is no longer in this audit"
            : `Count not saved: the audit kept ${storedCount}`
        );
      }
    },
    [showToast]
  );

  // Callback for when a scan exhausts its retries — surface it in the list so
  // the worker sees it never reached the server (and completion is blocked).
  const handleScanFailed = useCallback((assetId: string) => {
    setScannedItemsRef.current?.((prev) =>
      prev.map((item) =>
        item.assetId === assetId ? { ...item, syncFailed: true } : item
      )
    );
  }, []);

  const {
    scanQueueRef,
    failedQueueRef,
    enqueueScan,
    processQueue,
    retryFailedScans,
    retryTimerRef,
  } = useScanQueue({
    orgId: currentOrg?.id,
    auditId,
    userId,
    scannedItemsRef: stableScannedItemsRef,
    onScanSynced: handleScanSynced,
    onScanFailed: handleScanFailed,
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
    recoveryPendingRef,
  } = useAuditInit({
    auditId,
    orgId: currentOrg?.id,
    userId,
    progressAnim,
    animateProgress,
    processQueue,
    scanQueueRef,
  });

  // Keep the stable ref in sync with the audit init ref
  stableScannedItemsRef.current = scannedItemsRef.current;
  // Wire up setScannedItems for the scan sync callback
  setScannedItemsRef.current = setScannedItems;

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

  // ── Evidence modal (notes + photos per scanned item) ──

  const [evidenceModalVisible, setEvidenceModalVisible] = useState(false);
  const [showCompleteSheet, setShowCompleteSheet] = useState(false);
  const isCompletingRef = useRef(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ScannedItem | null>(null);
  // Opening the sheet once proves the user found evidence capture, which
  // retires the coachmark for good.
  const [hasOpenedEvidence, setHasOpenedEvidence] = useState(false);
  // Wire up setSelectedItem for the scan sync callback
  setSelectedItemRef.current = setSelectedItem;

  const handleItemPress = useCallback((item: ScannedItem) => {
    setSelectedItem(item);
    setEvidenceModalVisible(true);
    setHasOpenedEvidence(true);
  }, []);

  const handleCloseEvidenceModal = useCallback(() => {
    setEvidenceModalVisible(false);
    setSelectedItem(null);
  }, []);

  /**
   * Undo a scan: the asset returns to whatever it was before, which for an
   * expected asset means "not scanned yet" and for an unexpected one means
   * leaving the audit entirely.
   *
   * The server recomputes the session counts inside the same transaction as
   * the removal, so those are adopted wholesale rather than decremented here
   * — the two statuses move different counters and only the server knows
   * which one this scan was.
   *
   * Idempotent, like the endpoint: a scan that was already gone leaves the same
   * screen behind as one removed here, because the person asked for the same
   * end state either way.
   */
  const handleRemoveScan = useCallback(
    async (item: ScannedItem) => {
      if (!currentOrg || !auditId) return;

      const { data, error } = await api.removeAuditScan(currentOrg.id, {
        auditSessionId: auditId,
        assetId: item.assetId,
      });

      if (error || !data) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Could not remove scan", error || "Something went wrong.");
        return;
      }

      // `removed: false` means the server holds no scan for this asset, which
      // is a different thing from "nothing happened". The sheet offers the undo
      // only once a scan has synced, so the scan did reach the server and has
      // since gone: removed from the web or another device, or by this call's
      // own retry — a lost response on a weak signal re-sends the request, and
      // the second one finds the row the first already deleted.
      //
      // Either way the end state is the one the person asked for, and the row
      // on screen asserts a scan that no longer exists. So it is cleaned up
      // exactly as a fresh removal; only the wording differs. Keeping it would
      // strand the asset: it would still hold its place in the dedup set, so it
      // could not even be scanned again.

      // Drop the row and let the asset be scannable again. The dedup set is
      // what makes a re-scan register rather than reading as a duplicate.
      //
      // The ref moves with the list, and the snapshot on disk with both: every
      // persistence path reads the ref, and recovery on next launch trusts
      // what it finds there. Leaving either behind would offer the removed
      // scan back as an unsynced one, and its asset would then read as
      // already scanned.
      const remaining = scannedItemsRef.current.filter(
        (scanned) => scanned.assetId !== item.assetId
      );
      scannedItemsRef.current = remaining;
      setScannedItems(remaining);
      scannedAssetIdsRef.current.delete(item.assetId);

      // Splice rather than reassign: the debounced saver holds these array
      // references. A queued entry for this asset would re-record the scan
      // that was just undone.
      for (const queue of [scanQueueRef.current, failedQueueRef.current]) {
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].assetId === item.assetId) queue.splice(i, 1);
        }
      }

      // Same policy the exit path uses: keep a snapshot while anything is
      // still unsynced, otherwise there is nothing worth recovering.
      const hasUnsyncedScans =
        scanQueueRef.current.length > 0 || failedQueueRef.current.length > 0;
      if (hasUnsyncedScans) {
        debouncedSaverRef.current?.flush(
          remaining,
          scanQueueRef.current,
          failedQueueRef.current
        );
      } else {
        void debouncedSaverRef.current?.clear();
      }
      // The totals describe rows the server holds — recomputed when it deleted
      // a scan, the session's own counters when it had none left to delete —
      // and scans still waiting in the queue are among neither. Adopting them
      // raw would erase the progress those scans already earned on screen, and
      // understate the walk until the audit is reopened. Add them back, deduped
      // by asset so a requeued entry counts once.
      const outstanding = new Map<string, boolean>();
      for (const queued of [
        ...scanQueueRef.current,
        ...failedQueueRef.current,
      ]) {
        outstanding.set(queued.assetId, queued.isExpected);
      }
      let pendingFound = 0;
      let pendingUnexpected = 0;
      for (const isExpected of outstanding.values()) {
        if (isExpected) pendingFound += 1;
        else pendingUnexpected += 1;
      }

      setFoundCount(data.foundAssetCount + pendingFound);
      setUnexpectedCount(data.unexpectedAssetCount + pendingUnexpected);
      animateProgress(data.foundAssetCount + pendingFound);

      handleCloseEvidenceModal();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(
        "duplicate",
        data.removed ? "Scan removed" : "Scan already removed",
        item.name?.trim() || "The asset can be scanned again."
      );
    },
    [
      currentOrg,
      auditId,
      setScannedItems,
      scannedItemsRef,
      scannedAssetIdsRef,
      scanQueueRef,
      failedQueueRef,
      debouncedSaverRef,
      setFoundCount,
      setUnexpectedCount,
      animateProgress,
      handleCloseEvidenceModal,
      showToast,
    ]
  );

  /**
   * Adopt the evidence counts the sheet read from the server.
   *
   * A row starts with the counts its scan reported, which are zero — but
   * evidence belongs to the audit's row for the asset, so an asset scanned
   * again after an undo still carries what was recorded before, and the row
   * would otherwise offer "Add photo/note" over evidence that exists.
   */
  const handleEvidenceCounts = useCallback(
    (assetId: string, counts: { notes: number; images: number }) => {
      // Computed from the ref, then written to both: the ref is what every
      // persistence path saves and what recovery reads back, so leaving it
      // behind would restore a row asserting evidence counts the audit no
      // longer has. Returning the same objects when nothing moved keeps the
      // list from re-rendering every time the sheet opens.
      let changed = false;
      const next = scannedItemsRef.current.map((scanned) => {
        if (scanned.assetId !== assetId) return scanned;
        if (
          (scanned.notesCount ?? 0) === counts.notes &&
          (scanned.imagesCount ?? 0) === counts.images
        ) {
          return scanned;
        }
        changed = true;
        return {
          ...scanned,
          notesCount: counts.notes,
          imagesCount: counts.images,
        };
      });
      if (changed) {
        scannedItemsRef.current = next;
        setScannedItems(next);
      }
      // The open sheet renders from its own snapshot of the row, so correcting
      // only the list would leave the badges above the very notes and photos
      // they are miscounting — and hide the line that says they survive an
      // undo, which is the case this exists for.
      setSelectedItem((prev) => {
        if (!prev || prev.assetId !== assetId) return prev;
        if (
          (prev.notesCount ?? 0) === counts.notes &&
          (prev.imagesCount ?? 0) === counts.images
        ) {
          return prev;
        }
        return {
          ...prev,
          notesCount: counts.notes,
          imagesCount: counts.images,
        };
      });
    },
    [setScannedItems, scannedItemsRef]
  );

  const handleEvidenceAdded = useCallback(
    (assetId: string, type: "note" | "image") => {
      // Optimistically update the local evidence count, computed from the ref
      // and written to both. The list and the ref are two stores of one thing,
      // and the ref is the one a removal rebuilds the list from and every
      // persistence path saves — an increment that lands only in React state
      // is reverted the moment any other row is undone.
      let changed = false;
      const next = scannedItemsRef.current.map((item) => {
        if (item.assetId !== assetId) return item;
        changed = true;
        return {
          ...item,
          notesCount:
            type === "note" ? (item.notesCount ?? 0) + 1 : item.notesCount,
          imagesCount:
            type === "image" ? (item.imagesCount ?? 0) + 1 : item.imagesCount,
        };
      });
      if (changed) {
        scannedItemsRef.current = next;
        setScannedItems(next);
      }
      // Also update the selected item in the modal
      setSelectedItem((prev) => {
        if (!prev || prev.assetId !== assetId) return prev;
        return {
          ...prev,
          notesCount:
            type === "note" ? (prev.notesCount ?? 0) + 1 : prev.notesCount,
          imagesCount:
            type === "image" ? (prev.imagesCount ?? 0) + 1 : prev.imagesCount,
        };
      });
    },
    [setScannedItems, scannedItemsRef]
  );

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
      retryTimerRef.current = null;
      // On exit, only clear persisted state if EVERYTHING has synced. If any
      // scans are still pending or failed, flush the latest snapshot and KEEP
      // it: clearing here would discard scans the worker saw as "Found",
      // which the server then marks MISSING on completion. A draft still
      // waiting on the Resume prompt is left as it is (`draftActionOnClose`).
      const action = draftActionOnClose({
        hasAudit: Boolean(auditId),
        hasUnsyncedScans:
          scanQueueRef.current.length > 0 || failedQueueRef.current.length > 0,
        recoveryPending: recoveryPendingRef.current,
      });
      if (action === "flush") {
        debouncedSaverRef.current?.flush(
          scannedItemsRef.current,
          scanQueueRef.current,
          failedQueueRef.current
        );
      } else if (action === "clear") {
        void debouncedSaverRef.current?.clear();
      } else {
        // A pending debounced write would replace the draft with the
        // screen's empty queues.
        debouncedSaverRef.current?.cancel();
      }
      /* eslint-enable react-hooks/exhaustive-deps */
    };
  }, [
    auditId,
    toastTimerRef,
    retryTimerRef,
    debouncedSaverRef,
    scanQueueRef,
    failedQueueRef,
    scannedItemsRef,
    recoveryPendingRef,
  ]);

  // ── Persist on background, resume on foreground ──────
  // why: iOS suspends the JS runtime when the app is backgrounded and may then
  // terminate it WITHOUT running React unmount cleanup — so the unmount flush
  // above never fires on an OS kill. Flush the latest snapshot the instant we
  // go inactive/background (the last moment JS runs), so a saw-as-Found scan
  // can't be lost to a background reclaim within the debounce window. On
  // return to foreground, re-kick the queue: retry timers do not advance while
  // suspended, so a queue frozen mid-backoff would otherwise stall.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "inactive" || next === "background") {
        const hasUnsynced =
          scanQueueRef.current.length > 0 || failedQueueRef.current.length > 0;
        if (auditId && hasUnsynced) {
          debouncedSaverRef.current?.flush(
            scannedItemsRef.current,
            scanQueueRef.current,
            failedQueueRef.current
          );
        }
      } else if (next === "active" && scanQueueRef.current.length > 0) {
        processQueue();
      }
    });
    return () => sub.remove();
  }, [
    auditId,
    debouncedSaverRef,
    scanQueueRef,
    failedQueueRef,
    scannedItemsRef,
    processQueue,
  ]);

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
    endScan(isProcessingRef);
    setIsProcessing(false);
    startCooldown();
  }, [startCooldown]);

  /**
   * Records a resolved scan: optimistic row, counters, feedback, the queued
   * server write and the crash-recovery snapshot. A quantity-tracked asset
   * arrives here with its count, after the count sheet.
   */
  const commitScan = useCallback(
    ({
      asset,
      codeId,
      isExpected,
      expectedRecord,
      count,
    }: {
      asset: { id: string; title: string };
      codeId: string;
      isExpected: boolean;
      expectedRecord: AuditExpectedAsset | undefined;
      count: {
        expectedQuantity: number;
        foundQuantity: number;
        unitOfMeasure: string | null;
      } | null;
    }) => {
      if (!auditId) return;
      try {
        // 4. Queue the server write first: the scan counts as recorded only
        // once the queue has taken it (`queueThenRecord`). A refused scan
        // (nobody, or another account than the queue's owner, is signed in) is
        // not counted, and the operator is told so.
        const queued = queueThenRecord(
          enqueueScan,
          {
            auditSessionId: auditId,
            qrId: codeId,
            assetId: asset.id,
            isExpected,
            ...(count ? { foundQuantity: count.foundQuantity } : {}),
          },
          {
            refuse: () => {
              flashFrame("error");
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              showToast("error", asset.title, SCAN_NOT_RECORDED);
            },
            record: () => {
              // 5. Optimistic update: instant feedback
              scannedAssetIdsRef.current.add(asset.id);

              // why: an expected asset's full record is already in memory, so the
              // row can show WHERE it belongs immediately. An unexpected asset has
              // no such record; its location fills in on the next audit load.
              const newItem: ScannedItem = {
                assetId: asset.id,
                name: asset.title,
                isExpected,
                scannedAt: new Date().toISOString(),
                locationName: expectedRecord?.locationName ?? null,
                thumbnailImage:
                  expectedRecord?.thumbnailImage ??
                  expectedRecord?.mainImage ??
                  null,
                ...(count ? count : {}),
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
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success
                );
                playScanSound();
                announce("Asset found");
                showToast(
                  "found",
                  asset.title,
                  count
                    ? `Counted ${count.foundQuantity} of ${count.expectedQuantity} · ${newFound}/${expectedTotal}`
                    : `Found · ${newFound}/${expectedTotal}`
                );
              } else {
                // Unexpected asset
                setUnexpectedCount((prev) => prev + 1);
                flashFrame("unexpected");
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                announce("Asset not in audit");
                showToast("unexpected", asset.title, "Unexpected asset");
              }
            },
          }
        );
        if (!queued) {
          finalizeScan();
          return;
        }

        // 6. Persist to disk for crash recovery (debounced)
        debouncedSaverRef.current?.save(
          scannedItemsRef.current,
          scanQueueRef.current,
          failedQueueRef.current
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
      foundCount,
      expectedTotal,
      flashFrame,
      showToast,
      animateProgress,
      enqueueScan,
      finalizeScan,
      scannedAssetIdsRef,
      setScannedItems,
      scannedItemsRef,
      setFoundCount,
      setUnexpectedCount,
      debouncedSaverRef,
      scanQueueRef,
      failedQueueRef,
    ]
  );

  /** Confirmed count: record the first scan, or send the recount. */
  const handleCountSubmit = useCallback(
    (foundQuantity: number) => {
      const request = countRequest;
      if (!request || !auditId) return;
      setCountRequest(null);

      if (request.mode === "first") {
        const commit = pendingCommitRef.current;
        pendingCommitRef.current = null;
        commit?.(foundQuantity);
        return;
      }

      // The server replaces the count of a scan it already has. The row shows
      // the new count only once the queue has taken it.
      const queued = queueThenRecord(
        enqueueScan,
        recountQueueEntry({
          auditSessionId: auditId,
          qrId: request.codeId,
          assetId: request.assetId,
          isExpected: request.isExpected,
          foundQuantity,
        }),
        {
          refuse: () =>
            showToast("error", request.assetTitle, SCAN_NOT_RECORDED),
          record: () => {
            setScannedItems((prev) => {
              const next = prev.map((item) =>
                item.assetId === request.assetId
                  ? {
                      ...item,
                      expectedQuantity: request.expectedQuantity,
                      foundQuantity,
                      unitOfMeasure: request.unitOfMeasure,
                    }
                  : item
              );
              scannedItemsRef.current = next;
              return next;
            });
          },
        }
      );
      if (!queued) {
        finalizeScan();
        return;
      }
      // The result toast waits for the server's answer (handleScanSynced).
      pendingRecountsRef.current.set(request.assetId, {
        assetTitle: request.assetTitle,
        entered: foundQuantity,
        expectedQuantity: request.expectedQuantity,
        isExpected: request.isExpected,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      showToast("duplicate", request.assetTitle, "Saving count…");
      finalizeScan();
    },
    [
      countRequest,
      auditId,
      setScannedItems,
      scannedItemsRef,
      enqueueScan,
      showToast,
      finalizeScan,
    ]
  );

  /** Sheet closed without a count: a first scan is dropped, a recount kept. */
  const handleCountClose = useCallback(() => {
    pendingCommitRef.current = null;
    setCountRequest(null);
    finalizeScan();
  }, [finalizeScan]);

  // ── Barcode scan handler ─────────────────────────────

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (!auditId || !currentOrg) return;
      if (!tryBeginScan(isProcessingRef, lastScanRef, data)) return;

      setIsProcessing(true);
      resetInactivityTimer();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      try {
        // A Shelf URL from ANOTHER server would otherwise be resolved against
        // this one and reported as "not found" — a baffling error for a code
        // that is perfectly valid on the instance that minted it.
        if (
          classifyScannedCode(data, getActiveServer().baseUrl).kind ===
          "foreign"
        ) {
          // Same feedback shape as every other rejected scan in this handler:
          // a silent return would look like the camera simply ignored a code
          // the user can see is valid.
          flashFrame("error");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast(
            "error",
            "Different Shelf Server",
            "Sign in to that server to use this code."
          );
          announce("Different Shelf Server. Sign in to that server to use it.");
          // finalizeScan() BEFORE returning: this handler has no `finally`, and
          // a bare return would leave isProcessingRef.current true forever —
          // the guard above would then reject every later scan and the camera
          // would stop delivering codes entirely.
          finalizeScan();
          return;
        }

        // 1. Resolve code -> asset (QR, SAM id, or barcode)
        const qrId = extractQrId(data);
        // SAM / sequential ids (e.g. SAM-0001) resolve via the QR route's
        // sequentialId branch, scoped to the workspace (web parity, ungated
        // by the Barcodes add-on). currentOrg is non-null here (guard above).
        const samId = !qrId ? parseSequentialId(data) : null;
        const qrLookupId = qrId ?? samId;
        let codeId: string;
        let codeOrgId: string | null;
        let asset: { id: string; title: string } | null;

        if (qrLookupId) {
          // ── Shelf QR / SAM path ──
          // Audit lookups only identify the code: the AuditScan is recorded
          // separately, so use the non-recording resolve. Otherwise every
          // audited item would also get an ad-hoc "last scanned" entry (web
          // parity: audits resolve through the non-recording get-scanned-item).
          const { data: qrData, error } = await api.getScannedItem(
            qrLookupId,
            currentOrg.id
          );
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

          codeId = qrLookupId;
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
            currentOrg.id,
            // why: records an AUDIT scan with no Activity note; the audit
            // keeps its own trail (the normal scanner omits this).
            "audit"
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

        // A quantity-tracked asset is counted, not just found. The audit's
        // own row says so for an expected asset; the lookup's asset type
        // covers an unexpected one.
        const expectedRecord = expectedAssetMapRef.current.get(asset.id);
        const lookedUp = asset as {
          type?: string;
          quantity?: number | null;
          unitOfMeasure?: string | null;
        };
        // 2. O(1) duplicate check, then 3. expected vs unexpected
        const decision = auditScanDecision({
          scannedRow: scannedAssetIdsRef.current.has(asset.id)
            ? scannedItemsRef.current.find((item) => item.assetId === asset.id)
            : undefined,
          expectedRecord,
          lookedUp,
          isExpected: expectedAssetIdsRef.current.has(asset.id),
        });

        if (decision.kind === "recount") {
          // Scanning a quantity-tracked asset again corrects its count. The
          // camera stays paused until the sheet closes (finalizeScan).
          setCountRequest({
            mode: "recount",
            assetId: asset.id,
            assetTitle: asset.title,
            codeId,
            isExpected: decision.isExpected,
            expectedQuantity: decision.expectedQuantity,
            foundQuantity: decision.foundQuantity,
            unitOfMeasure: decision.unitOfMeasure,
          });
          return;
        }

        if (decision.kind === "duplicate") {
          flashFrame("duplicate");
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          showToast("duplicate", "Already Scanned", asset.title);
          finalizeScan();
          return;
        }

        if (decision.kind === "first") {
          // Ask for the count first; the scan is recorded on confirm and
          // dropped if the sheet is closed.
          const { expectedQuantity, isExpected, unitOfMeasure } = decision;
          setCountRequest({
            mode: "first",
            assetId: asset.id,
            assetTitle: asset.title,
            codeId,
            isExpected,
            expectedQuantity,
            foundQuantity: null,
            unitOfMeasure,
          });
          pendingCommitRef.current = (foundQuantity: number) =>
            commitScan({
              asset,
              codeId,
              isExpected,
              expectedRecord,
              count: { expectedQuantity, foundQuantity, unitOfMeasure },
            });
          return;
        }

        commitScan({
          asset,
          codeId,
          isExpected: decision.isExpected,
          expectedRecord,
          count: null,
        });
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
      // stable ref object; listed to satisfy exhaustive-deps, never changes
      expectedAssetMapRef,
      flashFrame,
      showToast,
      resetInactivityTimer,
      finalizeScan,
      scannedAssetIdsRef,
      expectedAssetIdsRef,
      scannedItemsRef,
      commitScan,
      lastScanRef,
    ]
  );

  /** The camera's frame callback; the handler's processing lock drops frames during a lookup. */
  const handleCameraScan = useCameraScanHandler(handleBarCodeScanned, false);

  // ── Complete audit ───────────────────────────────────

  // Performs the actual completion request + cleanup. Extracted so it can be
  // reached both from the normal confirm and the "complete anyway" path.
  const runCompletion = useCallback(
    async (completionNote?: string) => {
      if (!auditId || !currentOrg) return;

      // TOCTOU guard: handleComplete blocked on a non-empty PENDING queue, but the
      // camera stays live while the confirm dialog is open, so a scan can have
      // been enqueued since that gate. Completing now would mark its asset MISSING
      // and the queue-clear below would destroy it. Re-gate on the pending queue
      // (this is the freshly-scanned path; the failed queue is what "Complete
      // anyway" intentionally accepts, and is unaffected here).
      if (scanQueueRef.current.length > 0) {
        processQueue();
        reportAuditDurabilityEvent("completion_blocked_unsynced", {
          auditId,
          reason: "toctou_pending",
          pending: scanQueueRef.current.length,
        });
        Alert.alert(
          "Scan still syncing",
          "A scan just came in and is still saving. Give it a moment, then tap Complete again."
        );
        return;
      }

      const timeZone = (() => {
        try {
          return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        } catch {
          return "UTC";
        }
      })();

      const { error: err } = await api.completeAudit(currentOrg.id, {
        sessionId: auditId,
        timeZone,
        completionNote,
      });

      if (err) {
        // Completion failed: KEEP recovery state so nothing is lost.
        Alert.alert("Error", err);
        return;
      }

      // Server accepted completion. Only now is it safe to drop the local
      // recovery snapshot. Clear the in-memory queues too (in place): otherwise
      // the unmount cleanup would see a non-empty failedQueue on navigate-back and
      // re-flush a recovery snapshot for an audit that is already completed.
      scanQueueRef.current.length = 0;
      failedQueueRef.current.length = 0;
      await debouncedSaverRef.current?.clear();

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      playScanSound();

      // Leave the scanner before confirming, and never from an alert callback.
      // The queues and the persisted snapshot are already cleared by this
      // point, so a confirmation the user never gets to tap would strand them
      // on a scanner with no recoverable state.
      router.back();
      Alert.alert("Audit Complete", `"${auditName}" has been completed.`, [
        {
          text: "OK",
          // Completing an audit is a clear "value delivered" moment, a good
          // (throttled, OS-gated) time to ask a happy user for a review. It
          // waits for OK so it never competes with this alert, and losing it
          // with a dropped alert costs nothing.
          onPress: () => void maybeAskForReview(),
        },
      ]);
    },
    [
      auditId,
      currentOrg,
      auditName,
      router,
      debouncedSaverRef,
      scanQueueRef,
      failedQueueRef,
      processQueue,
    ]
  );

  // Standard confirm. The sheet names the audit, states how many unscanned
  // assets become missing, and takes the closing note: the same confirmation
  // the detail screen shows, so a worker finishing at the scanner gets the note
  // field too.
  const confirmAndComplete = useCallback(() => {
    setShowCompleteSheet(true);
  }, []);

  // Completion driven by the sheet: the note travels with the request. The
  // sheet is dismissed before the request is sent, and `isCompleting` keeps it
  // disabled if the worker reopens it while the request is still in flight.
  // The sheet keeps its note, so a blocked or failed completion can be retried
  // without retyping it.
  const handleSheetConfirm = useCallback(
    async (completionNote?: string) => {
      // Re-entry guard: the sheet is dismissed immediately below, so it cannot
      // confirm twice, but the ref is set synchronously and covers the gap
      // before React applies that state.
      if (isCompletingRef.current) return;
      isCompletingRef.current = true;
      setIsCompleting(true);

      // Dismissed BEFORE the request. `runCompletion` reports its outcome with
      // `Alert.alert`, and an alert presented from a modal that is then torn
      // down can be dismissed along with it, taking the message and any
      // action attached to it.
      setShowCompleteSheet(false);

      try {
        await runCompletion(completionNote);
      } finally {
        isCompletingRef.current = false;
        setIsCompleting(false);
      }
    },
    [runCompletion]
  );

  const handleComplete = useCallback(() => {
    if (!auditId || !currentOrg) return;

    // Scans still actively retrying (transient failures). Completing now would
    // mark these locally-"Found" assets MISSING on the server, so ask the
    // worker to wait while syncing continues.
    const pendingCount = scanQueueRef.current.length;
    if (pendingCount > 0) {
      processQueue();
      reportAuditDurabilityEvent("completion_blocked_unsynced", {
        auditId,
        reason: "pending",
        pending: pendingCount,
      });
      Alert.alert(
        "Scans still syncing",
        `${pendingCount} scan${pendingCount === 1 ? "" : "s"} ${
          pendingCount === 1 ? "is" : "are"
        } still syncing. Stay on this screen with an internet connection, ` +
          `then complete again.`
      );
      return;
    }

    // Scans that exhausted their retries. These may be permanent failures (an
    // asset deleted or moved to another workspace returns a 404 that will never
    // succeed), so we must NOT trap the audit. Offer to retry or to complete
    // anyway (acknowledging those assets will be marked missing).
    const failedCount = failedQueueRef.current.length;
    // A failed recount only loses the correction: the scan itself is saved and
    // keeps its last saved count. Say so instead of "marked as missing".
    const failedRecounts = failedQueueRef.current.filter(
      (entry) => entry.recount
    ).length;
    if (failedCount > 0) {
      // Highest-signal case: the worker is completing an audit that has scans
      // which exhausted retries — those assets will be marked MISSING unless
      // re-synced. Report at error level.
      reportAuditDurabilityEvent(
        "completion_blocked_unsynced",
        { auditId, reason: "failed", failed: failedCount },
        "error"
      );
      Alert.alert(
        "Some scans didn't sync",
        failedRecounts === failedCount
          ? `${failedCount} count correction${
              failedCount === 1 ? "" : "s"
            } couldn't be saved to the server after several tries. Retry, ` +
              `or complete anyway (the last saved count${
                failedCount === 1 ? " is" : "s are"
              } kept).`
          : `${failedCount} scan${
              failedCount === 1 ? "" : "s"
            } couldn't be saved ` +
              `to the server after several tries. Retry, or complete anyway ` +
              `(${
                failedCount === 1 ? "it" : "they"
              } will be marked as missing).`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Retry sync", onPress: retryFailedScans },
          {
            text: "Complete anyway",
            style: "destructive",
            onPress: confirmAndComplete,
          },
        ]
      );
      return;
    }

    confirmAndComplete();
  }, [
    auditId,
    currentOrg,
    scanQueueRef,
    failedQueueRef,
    processQueue,
    retryFailedScans,
    confirmAndComplete,
  ]);

  // ── Remaining assets (expected but not yet scanned) ──

  const remainingCount = expectedTotal - foundCount;

  /**
   * Opt-in filter for the Scanned tab, toggled by the unexpected count badge.
   *
   * why NOT a sort: pinning unexpected items to the top permanently was tried
   * and broke the scan feedback loop. The list is newest-first so the row you
   * just scanned confirms the scan; with exceptions pinned above it, a fresh
   * scan lands below them, and since the panel shows only a couple of rows,
   * three exceptions would push it off-screen entirely. During rapid scanning
   * that reads as "it didn't register" and people rescan.
   *
   * So scan order is left alone and the exception count becomes a filter the
   * user asks for, at the moment they want it, instead of a reordering imposed
   * on every scan.
   */
  const [showUnexpectedOnly, setShowUnexpectedOnly] = useState(false);

  const visibleScannedItems = useMemo(
    () =>
      showUnexpectedOnly
        ? scannedItems.filter((i) => !i.isExpected)
        : scannedItems,
    [scannedItems, showUnexpectedOnly]
  );

  // why: the filter must not strand the user on an empty list if the only
  // unexpected item is removed or the audit reloads without one.
  useEffect(() => {
    if (showUnexpectedOnly && unexpectedCount === 0) {
      setShowUnexpectedOnly(false);
    }
  }, [showUnexpectedOnly, unexpectedCount]);

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
          expectedQuantity: asset.expectedQuantity ?? null,
          unitOfMeasure: asset.unitOfMeasure ?? null,
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

  // Upright, the camera sits above the progress and the scanned list, the way
  // a phone is held. On a screen wider than it is tall (a foldable or a
  // tablet turned sideways) that would leave a letterbox of camera over a
  // short list, so the list moves beside the camera instead.
  const cameraSection = (
    <View style={styles.cameraSection}>
      {isFocused && !isPaused && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torchEnabled}
          barcodeScannerSettings={{
            barcodeTypes: ["qr", "code128", "code39", "datamatrix", "ean13"],
          }}
          // Always a function: swapping it for undefined reconfigures the iOS
          // capture session and switches the torch off. The handler's
          // processing lock drops frames during a lookup instead.
          onBarcodeScanned={handleCameraScan}
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
        <View
          style={[
            styles.cameraHeader,
            {
              paddingTop: cameraEdges.top,
              paddingLeft: spacing.lg + cameraEdges.left,
              paddingRight: spacing.lg + cameraEdges.right,
            },
          ]}
        >
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

        {/* Scan frame: hidden while paused so it doesn't bleed through the paused overlay */}
        {!isPaused && (
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
              {!frameHighlight && (
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
        )}

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
            {
              left: spacing.lg + cameraEdges.left,
              right: spacing.lg + cameraEdges.right,
            },
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
  );

  // Manual code entry: type a QR id, barcode value, or SAM id when a label
  // can't be scanned. Feeds the same resolution pipeline as the camera. Web
  // parity: the web audit scanner (audits.$auditId.scan.tsx) uses the shared
  // CodeScanner, which exposes a manual code-entry Input. testIDs and state
  // keep the `dev-scan`/`devScan` prefix so the e2e flows stay stable.
  const manualEntry = (
    <View
      style={[
        styles.devScanContainer,
        {
          paddingLeft: spacing.md + cameraEdges.left,
          paddingRight: spacing.md + cameraEdges.right,
          // Beside the list it is the camera column's bottom row: clear of the
          // home indicator when the tab sidebar leaves that edge uncovered.
          paddingBottom: spacing.xs + split.camera.bottom,
        },
      ]}
    >
      {devScanVisible ? (
        <View style={styles.devScanRow}>
          <TextInput
            testID="dev-scan-input"
            style={styles.devScanInput}
            value={devScanInput}
            onChangeText={setDevScanInput}
            placeholder="Enter QR, barcode, or SAM ID"
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
            accessibilityLabel="Look up code"
          >
            <Ionicons name="arrow-forward" size={16} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.devScanClose}
            onPress={() => setDevScanVisible(false)}
            accessibilityLabel="Close manual entry"
          >
            <Ionicons name="close" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          testID="dev-scan-toggle"
          style={styles.devScanToggle}
          onPress={() => setDevScanVisible(true)}
          accessibilityLabel="Enter a code manually"
        >
          <Ionicons name="keypad-outline" size={14} color="#fff" />
          <Text style={styles.devScanToggleText}>Enter code</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // Progress and the scanned / not-scanned lists.
  const panel = (
    <View
      style={[
        styles.bottomPanel,
        sideBySide && styles.bottomPanelBeside,
        {
          // Beside the camera the panel reaches the top of the screen.
          paddingTop: spacing.md + split.panel.top,
          paddingLeft: spacing.lg + split.panel.left,
          paddingRight: spacing.lg + split.panel.right,
          // Below a tab sidebar nothing takes the home-indicator inset.
          paddingBottom: split.panel.bottom,
        },
      ]}
    >
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
          unexpectedCount={unexpectedCount}
          unexpectedFilterActive={showUnexpectedOnly}
          onUnexpectedPress={() => {
            // The badge sits inside the Scanned tab button, and React Native
            // gives the press to the inner touchable only, so the parent tab
            // never fires. Switch the tab here: without it a press from the
            // Not-scanned tab flips the filter while that list stays on screen.
            setActiveTab("scanned");
            setShowUnexpectedOnly((v) => !v);
          }}
        />

        {/* why: the evidence sheet lives behind a row tap, so name it once
              the first row exists — on the Scanned tab, where the rows are. */}
        {activeTab === "scanned" && (
          <EvidenceCoachmark
            enabled={scannedItems.length > 0}
            hasOpenedEvidence={hasOpenedEvidence}
          />
        )}

        {/* List content */}
        {activeTab === "scanned" ? (
          <ScannedItemsList
            items={visibleScannedItems}
            onItemPress={handleItemPress}
          />
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
  );

  return (
    <View
      style={[styles.container, sideBySide && styles.containerBeside]}
      onLayout={onScreenLayout}
    >
      {/* One element tree in both layouts, so switching between them
          restyles the camera instead of remounting it. */}
      <View
        style={sideBySide ? styles.cameraColumnBeside : styles.cameraColumn}
      >
        {cameraSection}
        {manualEntry}
      </View>
      {panel}

      <QuantityInputSheet
        visible={countRequest !== null}
        title={
          countRequest?.mode === "recount" ? "Update count" : "Count units"
        }
        subtitle={
          countRequest
            ? `${countRequest.assetTitle} · ${
                countExpectationValue === "expected"
                  ? `${countRequest.expectedQuantity} expected`
                  : countExpectationValue === "none-expected"
                  ? "none expected here"
                  : "not on this audit's list"
              }`
            : undefined
        }
        min={0}
        // A count may go past the expectation (a surplus), so the sheet's
        // ceiling is the server's and the expectation is only its target. An
        // asset not on the audit's list has no expectation to count against.
        max={MAX_AUDIT_COUNT}
        target={
          countExpectationValue === "expected"
            ? countRequest?.expectedQuantity
            : undefined
        }
        placeholder="Units found"
        defaultValue={countRequest ? countSheetDefault(countRequest) : null}
        unitOfMeasure={countRequest?.unitOfMeasure}
        confirmLabel={countRequest?.mode === "recount" ? "Update" : "Record"}
        onSubmit={handleCountSubmit}
        onClose={handleCountClose}
      />

      <CompleteAuditSheet
        key={auditId}
        visible={showCompleteSheet}
        auditName={auditName}
        pendingCount={Math.max(0, expectedTotal - foundCount)}
        isSubmitting={isCompleting}
        onClose={() => setShowCompleteSheet(false)}
        onConfirm={(note) => void handleSheetConfirm(note)}
      />

      {/* Evidence modal for adding notes + photos to scanned items */}
      <EvidenceModal
        visible={evidenceModalVisible}
        onClose={handleCloseEvidenceModal}
        item={selectedItem}
        auditSessionId={auditId ?? ""}
        onEvidenceAdded={handleEvidenceAdded}
        onRemoveScan={handleRemoveScan}
        onEvidenceCounts={handleEvidenceCounts}
      />
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  containerBeside: {
    flexDirection: "row",
  },
  // Holds the camera and the manual entry. Upright, it takes the manual
  // entry's height plus 6 of the 11 shares of what is left (the panel takes
  // 5), so the camera gets 6/11 of the space beside the manual-entry row.
  cameraColumn: {
    flexGrow: 6,
    flexShrink: 1,
    flexBasis: "auto",
    // Above the panel, which overlaps it from below: the manual-entry row
    // inside must stay visible and take its own taps.
    zIndex: 1,
  },
  // Beside the list on a wide screen: 6 of 11 shares of the width.
  cameraColumnBeside: {
    flex: 6,
    zIndex: 1,
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

  // Camera: above the manual entry, in the camera column.
  cameraSection: {
    flex: 1,
    backgroundColor: "#000",
    position: "relative",
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: "space-between",
  },

  // Camera header
  // Padding comes from the screen's insets at render time.
  cameraHeader: {
    flexDirection: "row",
    alignItems: "center",
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
    ...StyleSheet.absoluteFill,
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
  // `left` and `right` come from the screen's insets at render time.
  toast: {
    position: "absolute",
    bottom: spacing.lg,
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

  // Bottom panel (~45%): the scanned list needs to show more than a row and
  // a half, otherwise a fresh scan can land below the fold.
  bottomPanel: {
    flex: 5,
    backgroundColor: colors.backgroundSecondary,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    marginTop: -12,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  // Beside the camera: rounded on the camera's side, without overlapping it,
  // so the scan frame stays centred in the camera the operator sees.
  bottomPanelBeside: {
    marginTop: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: borderRadius.xl,
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
  // Side padding comes from the screen's insets at render time.
  devScanContainer: {
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
    color: "rgba(255,255,255,0.9)",
    fontSize: fontSize.xs,
    fontWeight: "600" as const,
    letterSpacing: 0.2,
  },
}));
