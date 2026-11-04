import { Stack } from "expo-router";
import { useTheme } from "@/lib/theme-context";

/**
 * The sign-in stack.
 *
 * No content column here: the sign-in screen scrolls the whole window and
 * holds its form to `FORM_MAX_WIDTH` inside the scroll view, so on a wide
 * window the scroll indicator runs down the window edge rather than beside
 * the form.
 */
export default function AuthLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: "fade",
      }}
    />
  );
}
