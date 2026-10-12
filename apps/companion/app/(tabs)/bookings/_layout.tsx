import { Platform } from "react-native";
import { Stack } from "expo-router";
import { contentColumnLayout } from "@/components/content-column";
import { useTheme } from "@/lib/theme-context";
import { fontSize } from "@/lib/constants";

/**
 * Anchor this stack at its list screen so cross-tab / deep-link navigation
 * into a booking always leaves a back path to the bookings list.
 */
export const unstable_settings = { initialRouteName: "index" };

/**
 * Booking screens sit in the content column on wide windows. On iOS the
 * Add-to-Booking modal is left alone: an iPad presents it as a sheet the system
 * sizes for the screen, so it needs no column of its own. Android presents it
 * full screen, so it takes the column like the rest.
 */
const BOOKINGS_SCREEN_LAYOUT = contentColumnLayout({
  except: Platform.OS === "ios" ? ["add-assets"] : [],
});

export default function BookingsLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenLayout={BOOKINGS_SCREEN_LAYOUT}
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
      <Stack.Screen name="index" options={{ title: "Bookings" }} />
      <Stack.Screen name="[id]" options={{ title: "Booking Details" }} />
      <Stack.Screen name="new" options={{ title: "New Booking" }} />
      <Stack.Screen name="edit" options={{ title: "Edit Booking" }} />
      <Stack.Screen
        name="add-assets"
        options={{ title: "Add to Booking", presentation: "modal" }}
      />
    </Stack>
  );
}
