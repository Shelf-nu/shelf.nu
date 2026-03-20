import React, { type ReactNode } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { ThemeContext } from "@/lib/theme-context";
import type { Colors } from "@/lib/theme-colors";

type Props = {
  children: ReactNode;
  /** Friendly label shown in the error UI (e.g. "Assets", "Bookings") */
  screenName?: string;
};

type State = {
  hasError: boolean;
};

/**
 * Reusable error boundary that catches render errors in a screen subtree
 * and shows a friendly recovery UI instead of crashing the whole app.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  static contextType = ThemeContext;

  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn(
      `[ErrorBoundary${
        this.props.screenName ? `:${this.props.screenName}` : ""
      }] Caught:`,
      error.message
    );
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    const { colors } = this.context as React.ContextType<typeof ThemeContext>;
    const styles = getStyles(colors);

    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Ionicons name="warning-outline" size={48} color={colors.error} />
          <Text style={styles.title}>
            {this.props.screenName
              ? `${this.props.screenName} Error`
              : "Something Went Wrong"}
          </Text>
          <Text style={styles.message}>
            An unexpected error occurred. Please try again.
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={this.handleRetry}
            accessibilityLabel="Try again"
            accessibilityRole="button"
          >
            <Ionicons
              name="refresh-outline"
              size={18}
              color={colors.primaryForeground}
            />
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

function getStyles(colors: Colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: colors.backgroundSecondary,
      padding: spacing.xxl,
      gap: spacing.md,
    },
    title: {
      fontSize: fontSize.xxl,
      fontWeight: "700",
      color: colors.foreground,
      textAlign: "center",
    },
    message: {
      fontSize: fontSize.base,
      color: colors.muted,
      textAlign: "center",
      paddingHorizontal: spacing.xxxl,
    },
    retryButton: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.xxl,
      paddingVertical: 12,
      borderRadius: borderRadius.md,
      marginTop: spacing.sm,
      gap: spacing.sm,
    },
    retryText: {
      color: colors.primaryForeground,
      fontWeight: "600",
      fontSize: fontSize.base,
    },
  });
}
