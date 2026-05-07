import { useEffect, useRef } from "react";
import { Animated, Platform } from "react-native";
import { useReducedMotion } from "@/lib/a11y";

/**
 * Drives the scan-line animation inside the viewfinder.
 *
 * Returns an `Animated.Value` that oscillates between 0 and 1
 * when the camera is active, or stays at 0.5 when reduced-motion
 * is enabled.
 *
 * @param isFocused  Whether the screen is currently focused.
 * @param isPaused   Whether the camera is paused.
 * @param extraConditions  Additional boolean conditions that must all
 *   be `true` for the animation to run (e.g. `!isInitializing`).
 */
export function useScanLineAnimation(
  isFocused: boolean,
  isPaused: boolean,
  ...extraConditions: boolean[]
): Animated.Value {
  const reduceMotion = useReducedMotion();
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  const shouldAnimate =
    isFocused && !isPaused && extraConditions.every(Boolean);

  useEffect(() => {
    if (!shouldAnimate) return;

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
  }, [shouldAnimate, scanLineAnim, reduceMotion]);

  return scanLineAnim;
}
