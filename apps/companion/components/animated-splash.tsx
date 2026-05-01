/**
 * Animated splash overlay — plays a branded entrance animation on app launch.
 *
 * Three-phase animation sequence:
 *  1. Fade in (0–300ms): Icon scales 0.8→1.0 with opacity 0→1, orange background
 *  2. Hold  (300–900ms): Wordmark fades in below icon (opacity 0→1, translateY 10→0)
 *  3. Reveal (900–1300ms): Overlay fades out + scales up slightly, revealing content beneath
 *
 * Respects `useReducedMotion()` — skips animation entirely when enabled.
 * Uses `position: 'absolute'` overlay (same pattern as OfflineBanner) to avoid
 * reserving layout space.
 */

import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";

import ShelfIcon from "@/components/brand/shelf-icon";
import ShelfWordmark from "@/components/brand/shelf-wordmark";
import { useReducedMotion } from "@/lib/a11y";

// ── Brand color ──────────────────────────────────────────────────────────────
const SHELF_ORANGE = "#FF7809";

// ── Timing (ms) ──────────────────────────────────────────────────────────────
const PHASE1_DURATION = 300;
const PHASE2_DURATION = 600;
const PHASE3_DURATION = 400;

type AnimatedSplashProps = {
  /** When true, auth state has resolved — trigger the reveal (phase 3). */
  isReady: boolean;
  /** Called after the reveal animation finishes. Parent should unmount this component. */
  onComplete: () => void;
};

export default function AnimatedSplash({
  isReady,
  onComplete,
}: AnimatedSplashProps) {
  const reduceMotion = useReducedMotion();

  // ── Animated values ──────────────────────────────────────────────────────
  const iconOpacity = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(0.8)).current;
  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const wordmarkTranslateY = useRef(new Animated.Value(10)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const overlayScale = useRef(new Animated.Value(1)).current;

  // Track whether phases 1+2 have finished so we can gate phase 3.
  const [introComplete, setIntroComplete] = useState(false);
  const hasStartedReveal = useRef(false);

  // ── Phase 1 + 2: play on mount ──────────────────────────────────────────
  useEffect(() => {
    // Hide the native splash screen now that our animated overlay is visible.
    SplashScreen.hideAsync().catch(() => {});

    if (reduceMotion) {
      // Skip all animation — jump straight to completion.
      setIntroComplete(true);
      return;
    }

    // Phase 1: icon fade in + scale
    Animated.parallel([
      Animated.timing(iconOpacity, {
        toValue: 1,
        duration: PHASE1_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(iconScale, {
        toValue: 1,
        duration: PHASE1_DURATION,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Phase 2: wordmark slides in
      Animated.parallel([
        Animated.timing(wordmarkOpacity, {
          toValue: 1,
          duration: PHASE2_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(wordmarkTranslateY, {
          toValue: 0,
          duration: PHASE2_DURATION,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setIntroComplete(true);
      });
    });
    // why: animation values from useRef (Animated.Value) are stable; listing them adds
    // noise without changing behavior
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  // ── Phase 3: reveal (after intro + auth ready) ──────────────────────────
  useEffect(() => {
    if (!introComplete || !isReady || hasStartedReveal.current) return;
    hasStartedReveal.current = true;

    if (reduceMotion) {
      onComplete();
      return;
    }

    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: PHASE3_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(overlayScale, {
        toValue: 1.05,
        duration: PHASE3_DURATION,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onComplete();
    });
    // why: animation values are stable refs; onComplete is invoked once on reveal end
    // and including it would defeat the hasStartedReveal guard
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introComplete, isReady, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.overlay,
        {
          opacity: overlayOpacity,
          transform: [{ scale: overlayScale }],
        },
      ]}
      pointerEvents={isReady && introComplete ? "none" : "auto"}
      accessibilityLabel="Loading Shelf"
      accessibilityRole="progressbar"
    >
      <View style={styles.content}>
        <Animated.View
          style={{
            opacity: iconOpacity,
            transform: [{ scale: iconScale }],
          }}
        >
          <ShelfIcon
            size={96}
            iconBgColor="transparent"
            iconShelfsColor="#FFFFFF"
          />
        </Animated.View>

        <Animated.View
          style={{
            opacity: wordmarkOpacity,
            transform: [{ translateY: wordmarkTranslateY }],
            marginTop: 16,
          }}
        >
          <ShelfWordmark width={110} color="#FFFFFF" />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SHELF_ORANGE,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999,
  },
  content: {
    alignItems: "center",
  },
});
