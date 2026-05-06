import { useRef, useEffect, useCallback } from "react";
import { PanResponder, Animated, Dimensions, Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { useReducedMotion } from "@/lib/a11y";

const SCREEN_WIDTH = Dimensions.get("window").width;
const SWIPE_THRESHOLD = 50;
const VELOCITY_THRESHOLD = 0.3;

/**
 * Reusable hook that adds Instagram-style horizontal swipe gestures
 * to cycle through filter pills / tabs.
 *
 * Returns:
 * - `panHandlers` — spread onto the swipeable area's View
 * - `animatedStyle` — apply to the content that should slide during transition
 * - `activeIndex` / `setActiveIndex` — the currently selected filter
 *
 * @param filterCount  Total number of filters/tabs
 * @param onFilterChange  Called with the new index when filter changes via swipe
 * @param options.wrap  Whether to wrap around (default: true)
 * @param options.enabled  Whether swipe is active (default: true)
 */
export function useSwipeFilters(
  filterCount: number,
  onFilterChange: (newIndex: number) => void,
  options?: { wrap?: boolean; enabled?: boolean }
) {
  const { wrap = true, enabled = true } = options ?? {};
  const reduceMotion = useReducedMotion();

  const activeIndexRef = useRef(0);
  const isSwipingRef = useRef(false);
  const enabledRef = useRef(enabled);
  const onFilterChangeRef = useRef(onFilterChange);

  // Keep refs in sync
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    onFilterChangeRef.current = onFilterChange;
  }, [onFilterChange]);

  // Animated values for content slide transition
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const animatedStyle = {
    transform: [{ translateX }],
    opacity,
  };

  /** Update the ref so the PanResponder always reads the latest index */
  const syncIndex = useCallback((index: number) => {
    activeIndexRef.current = index;
  }, []);

  const reduceMotionRef = useRef(reduceMotion);
  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
  }, [reduceMotion]);

  const triggerTransition = useCallback(
    (nextIndex: number, direction: number) => {
      if (isSwipingRef.current) return;
      isSwipingRef.current = true;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Skip animation when reduced motion is enabled
      if (reduceMotionRef.current) {
        onFilterChangeRef.current(nextIndex);
        activeIndexRef.current = nextIndex;
        translateX.setValue(0);
        opacity.setValue(1);
        isSwipingRef.current = false;
        return;
      }

      // Phase 1: Slide content out
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: direction * SCREEN_WIDTH * 0.25,
          duration: 140,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 140,
          useNativeDriver: Platform.OS !== "web",
        }),
      ]).start(() => {
        // Midpoint: change filter
        onFilterChangeRef.current(nextIndex);
        activeIndexRef.current = nextIndex;

        // Phase 2: Slide new content in from opposite side
        translateX.setValue(-direction * SCREEN_WIDTH * 0.25);

        Animated.parallel([
          Animated.timing(translateX, {
            toValue: 0,
            duration: 180,
            useNativeDriver: Platform.OS !== "web",
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 180,
            useNativeDriver: Platform.OS !== "web",
          }),
        ]).start(() => {
          isSwipingRef.current = false;
        });
      });
    },
    [translateX, opacity]
  );

  const triggerRef = useRef(triggerTransition);
  useEffect(() => {
    triggerRef.current = triggerTransition;
  }, [triggerTransition]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, { dx, dy }) => {
        if (!enabledRef.current) return false;
        if (isSwipingRef.current) return false;
        // High thresholds to avoid stealing vertical scroll / pull-to-refresh
        return (
          Math.abs(dx) > 20 &&
          Math.abs(dy) < 15 &&
          Math.abs(dx) > Math.abs(dy) * 2
        );
      },
      onPanResponderRelease: (_evt, { dx, vx }) => {
        const swipedLeft = dx < -SWIPE_THRESHOLD || vx < -VELOCITY_THRESHOLD;
        const swipedRight = dx > SWIPE_THRESHOLD || vx > VELOCITY_THRESHOLD;
        if (!swipedLeft && !swipedRight) return;

        const count = filterCount; // captured at creation — but filterCount rarely changes
        const current = activeIndexRef.current;
        let next: number;

        if (swipedLeft) {
          next = current + 1;
          if (next >= count) next = wrap ? 0 : count - 1;
        } else {
          next = current - 1;
          if (next < 0) next = wrap ? count - 1 : 0;
        }

        if (next === current) return;
        triggerRef.current(next, swipedLeft ? -1 : 1);
      },
      onPanResponderTerminationRequest: () => true,
    })
  ).current;

  return {
    panHandlers: panResponder.panHandlers,
    animatedStyle,
    syncIndex,
  };
}
