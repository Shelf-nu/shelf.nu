import React, { type ReactNode } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme-context";

/**
 * Props for the error boundary. Accepts an optional `useStyles` hook
 * so each consumer can provide its own stylesheet (the style-key names
 * `centered`, `messageTitle`, `messageBody`, `actionButton / primaryButton`,
 * and `actionButtonText / primaryButtonText` are expected).
 */
type ScannerErrorBoundaryProps = {
  children: ReactNode;
  /** Human-readable label used in the console warning, e.g. "Scanner" or "AuditScanner". */
  label?: string;
};

/** Functional fallback component that can use hooks for theming. */
export function ScannerErrorFallback({ onRetry }: { onRetry: () => void }) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 24,
        backgroundColor: colors.background,
      }}
    >
      <Ionicons name="warning-outline" size={48} color={colors.error} />
      <Text
        style={{
          fontSize: 18,
          fontWeight: "600",
          color: colors.foreground,
          marginTop: 16,
          textAlign: "center",
        }}
      >
        Camera Error
      </Text>
      <Text
        style={{
          fontSize: 14,
          color: colors.foregroundSecondary,
          marginTop: 8,
          textAlign: "center",
        }}
      >
        Something went wrong with the camera.
      </Text>
      <TouchableOpacity
        style={{
          marginTop: 24,
          paddingHorizontal: 24,
          paddingVertical: 12,
          borderRadius: 8,
          backgroundColor: colors.primary,
        }}
        onPress={onRetry}
      >
        <Text
          style={{
            color: "#fff",
            fontWeight: "600",
            fontSize: 14,
          }}
        >
          Try Again
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Class-based error boundary that wraps scanner screens.
 *
 * Usage:
 * ```tsx
 * <ScannerErrorBoundary label="AuditScanner">
 *   <AuditScannerContent />
 * </ScannerErrorBoundary>
 * ```
 */
export class ScannerErrorBoundary extends React.Component<
  ScannerErrorBoundaryProps,
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    const label = this.props.label ?? "Scanner";
    console.warn(`[${label}] Error boundary caught:`, error.message);
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
