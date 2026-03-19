import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { useTheme } from "./theme-context";
import type { Colors, Shadows } from "./theme-colors";

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
export function createStyles<
  T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>,
>(
  factory: (colors: Colors, shadows: Shadows) => T | StyleSheet.NamedStyles<T>
) {
  return function useStyles(): T {
    const { colors, shadows } = useTheme();
    return useMemo(
      () => StyleSheet.create(factory(colors, shadows) as T),
      [colors, shadows]
    );
  };
}
