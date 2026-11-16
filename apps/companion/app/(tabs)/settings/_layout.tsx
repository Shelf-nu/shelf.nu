/**
 * Settings tab stack.
 *
 * The Settings list is the stack's root; rows that need a screen of their own
 * (Notifications) push onto it, so the tab bar stays visible and back returns
 * to the list. The push settings live here, once, for both the Settings row
 * and the Notifications screen.
 *
 * @see {@link file://./index.tsx} the Settings list
 * @see {@link file://./notifications.tsx} push notification settings
 * @see {@link file://../../../hooks/use-push-settings.ts} the shared state
 */
import { Stack } from "expo-router";
import { PushSettingsProvider } from "@/hooks/use-push-settings";
import { contentColumnLayout } from "@/components/content-column";
import { useTheme } from "@/lib/theme-context";
import { fontSize } from "@/lib/constants";

/**
 * Anchor this stack at the Settings list, so navigating straight to a nested
 * settings screen still leaves a back path to the list.
 */
export const unstable_settings = { initialRouteName: "index" };

/** Every settings screen sits in the content column on wide windows. */
const SETTINGS_SCREEN_LAYOUT = contentColumnLayout({});

/** The Settings tab's stack navigator. */
export default function SettingsLayout() {
  const { colors } = useTheme();

  return (
    <PushSettingsProvider>
      <Stack
        screenLayout={SETTINGS_SCREEN_LAYOUT}
        screenOptions={{
          headerStyle: { backgroundColor: colors.white },
          headerTitleStyle: {
            fontWeight: "600",
            fontSize: fontSize.xl,
            color: colors.foreground,
          },
          headerShadowVisible: false,
          headerTintColor: colors.foreground,
          headerBackButtonDisplayMode: "minimal",
          gestureEnabled: true,
        }}
      >
        <Stack.Screen name="index" options={{ title: "Settings" }} />
        <Stack.Screen
          name="notifications"
          options={{ title: "Notifications" }}
        />
      </Stack>
    </PushSettingsProvider>
  );
}
