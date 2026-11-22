import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { useTheme } from "./theme-context";
import type { Colors, Shadows } from "./theme-colors";

/**
 * What `StyleSheet.create` accepts, read off `create` itself: React Native's
 * strict TypeScript API exports no named type for it.
 */
type NamedStyles = Parameters<typeof StyleSheet.create>[0];

/**
 * Factory that turns a style-factory function into a hook.
 *
 * Usage:
 * ```ts
 * const useStyles = createStyles((colors, shadows) => ({
 *   container: { flex: 1, backgroundColor: colors.background },
 * }));
 *
 * function MyScreen() {
 *   const styles = useStyles();
 *   return <View style={styles.container} />;
 * }
 * ```
 *
 * The returned hook re-creates the StyleSheet only when the theme changes.
 */
export function createStyles<T extends NamedStyles>(
  factory: (colors: Colors, shadows: Shadows) => T
) {
  return function useStyles(): Readonly<T> {
    const { colors, shadows } = useTheme();
    return useMemo(
      () => StyleSheet.create(factory(colors, shadows)),
      [colors, shadows]
    );
  };
}
