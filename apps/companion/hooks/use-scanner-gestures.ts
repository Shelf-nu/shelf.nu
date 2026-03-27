import { useCallback, useEffect, useRef } from "react";
import { Animated, PanResponder, Platform, Dimensions } from "react-native";
import * as Haptics from "expo-haptics";
import { useReducedMotion } from "@/lib/a11y";

const SCREEN_WIDTH = Dimensions.get("window").width;

type ScannerAction =
  | "view"
  | "assign_custody"
  | "release_custody"
  | "update_location";

type ActionItem = {
  key: ScannerAction;
  label: string;
  icon: string;
  permission: { entity: string; action: string };
};

type UseScannerGesturesParams = {
  availableActions: ActionItem[];
  action: ScannerAction;
  handleActionChange: (action: ScannerAction) => void;
  /** Refs to external state so the PanResponder closure stays current */
  isBookingMode: boolean;
  isPaused: boolean;
  isProcessing: boolean;
  isSubmitting: boolean;
  scannedItemsCount: number;
};

/**
 * Encapsulates PanResponder + swipe animation logic for the scanner
 * mode switcher (Instagram-style horizontal swipe between actions).
 */
export function useScannerGestures({
  availableActions,
  action,
  handleActionChange,
  isBookingMode,
  isPaused,
  isProcessing,
  isSubmitting,
  scannedItemsCount,
}: UseScannerGesturesParams) {
  const reduceMotion = useReducedMotion();

  // Animated values for slide transition
  const swipeTranslateX = useRef(new Animated.Value(0)).current;
  const swipeOpacity = useRef(new Animated.Value(1)).current;
  const isSwipingRef = useRef(false);
  const actionIndexRef = useRef(0);

  // Keep refs in sync so the PanResponder (created once) avoids stale closures
  const isBookingModeRef = useRef(isBookingMode);
  useEffect(() => {
    isBookingModeRef.current = isBookingMode;
  }, [isBookingMode]);

  const isPausedRef = useRef(isPaused);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  const isProcessingRef = useRef(isProcessing);
  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  const isSubmittingRef = useRef(isSubmitting);
  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  const scannedItemsCountRef = useRef(scannedItemsCount);
  useEffect(() => {
    scannedItemsCountRef.current = scannedItemsCount;
  }, [scannedItemsCount]);

  useEffect(() => {
    const idx = availableActions.findIndex((a) => a.key === action);
    actionIndexRef.current = idx >= 0 ? idx : 0;
  }, [action, availableActions]);

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
        handleActionChange(nextAction);
        swipeTranslateX.setValue(0);
        swipeOpacity.setValue(1);
        isSwipingRef.current = false;
        return;
      }

      // Smooth 2-phase slide: out -> change -> in
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
        handleActionChange(nextAction);

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

  // Ref to always hold the latest triggerSwipeTransition callback
  const triggerSwipeRef = useRef(triggerSwipeTransition);
  useEffect(() => {
    triggerSwipeRef.current = triggerSwipeTransition;
  }, [triggerSwipeTransition]);

  // ── PanResponder ──────────────────────────────────
  const panResponder = useRef(
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
        const len = availableActions.length;
        const nextIdx = swipedLeft
          ? (currentIdx + 1) % len
          : (currentIdx - 1 + len) % len;

        if (nextIdx === currentIdx) return;

        const nextAction = availableActions[nextIdx].key;
        const direction = swipedLeft ? -1 : 1;
        triggerSwipeRef.current?.(nextAction, direction);
      },
      onPanResponderTerminationRequest: () => true,
    })
  ).current;

  return {
    panResponder,
    swipeTranslateX,
    swipeOpacity,
    triggerSwipeRef,
  };
}
