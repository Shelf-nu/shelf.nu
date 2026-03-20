import { useState, useCallback, useRef, useEffect } from "react";
import * as Haptics from "expo-haptics";

type ScanResult = {
  type: "success" | "error" | "not_found";
  title: string;
  message: string;
} | null;

type FrameHighlight = "success" | "error" | null;

type UseScanProcessingParams = {
  resetTimer: () => void;
};

/**
 * Manages scan result state, processing lock, frame highlight flash,
 * pause/resume, and torch toggle for the scanner screen.
 */
export function useScanProcessing({ resetTimer }: UseScanProcessingParams) {
  // Processing lock
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);

  // Scan result display
  const [scanResult, setScanResult] = useState<ScanResult>(null);

  // Frame highlight flash
  const [frameHighlight, setFrameHighlight] = useState<FrameHighlight>(null);
  const frameHighlightTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Pause / resume
  const [isPaused, setIsPaused] = useState(false);

  // Torch
  const [torchEnabled, setTorchEnabled] = useState(false);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (frameHighlightTimer.current)
        clearTimeout(frameHighlightTimer.current);
    };
  }, []);

  /** Flash frame corners on scan result (Scandit/Scanbot pattern) */
  const flashFrame = useCallback((type: "success" | "error") => {
    if (frameHighlightTimer.current) clearTimeout(frameHighlightTimer.current);
    setFrameHighlight(type);
    frameHighlightTimer.current = setTimeout(() => {
      setFrameHighlight(null);
    }, 500);
  }, []);

  /** Toggle pause/resume with haptic feedback */
  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      if (prev) {
        // Resuming -- restart inactivity timer
        resetTimer();
      }
      return !prev;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [resetTimer]);

  /** Toggle torch on/off */
  const toggleTorch = useCallback(() => {
    setTorchEnabled((prev) => !prev);
  }, []);

  /** Dismiss the scan result card */
  const dismissResult = useCallback(() => {
    setScanResult(null);
  }, []);

  return {
    isProcessing,
    setIsProcessing,
    isProcessingRef,
    scanResult,
    setScanResult,
    frameHighlight,
    flashFrame,
    isPaused,
    setIsPaused,
    togglePause,
    torchEnabled,
    toggleTorch,
    dismissResult,
  };
}
