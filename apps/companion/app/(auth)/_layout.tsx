import { Stack } from "expo-router";
import { contentColumnLayout } from "@/components/content-column";
import { FORM_MAX_WIDTH } from "@/lib/content-column";
import { useTheme } from "@/lib/theme-context";

/** The sign-in screens are short forms, so they keep a narrower column. */
const AUTH_SCREEN_LAYOUT = contentColumnLayout({ maxWidth: FORM_MAX_WIDTH });

export default function AuthLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenLayout={AUTH_SCREEN_LAYOUT}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: "fade",
      }}
    />
  );
}
