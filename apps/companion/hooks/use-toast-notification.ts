import { useState, useRef, useCallback, useEffect } from "react";
import { Animated, Platform } from "react-native";

// ── Constants ────────────────────────────────────────────

const TOAST_DURATION_MS = 1_500;

// ── Types ────────────────────────────────────────────────

export type ScanResult = "found" | "unexpected" | "duplicate" | "error";

export type ToastData = {
  type: ScanResult;
  title: string;
  subtitle: string;
};

export type ToastNotificationResult = {
  toast: ToastData | null;
  toastAnim: Animated.Value;
  toastTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  showToast: (type: ScanResult, title: string, subtitle: string) => void;
};

// ── Hook ─────────────────────────────────────────────────

export function useToastNotification(): ToastNotificationResult {
  const [toast, setToast] = useState<ToastData | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = useCallback(
    (type: ScanResult, title: string, subtitle: string) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToast({ type, title, subtitle });

      // Slide in
      Animated.timing(toastAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: Platform.OS !== "web",
      }).start();

      // Auto-dismiss
      toastTimerRef.current = setTimeout(() => {
        Animated.timing(toastAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: Platform.OS !== "web",
        }).start(() => setToast(null));
      }, TOAST_DURATION_MS);
    },
    [toastAnim]
  );

  return {
    toast,
    toastAnim,
    toastTimerRef,
    showToast,
  };
}
