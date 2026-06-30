import { Stack } from "expo-router";
import { useTheme } from "@/lib/theme-context";
import { fontSize } from "@/lib/constants";

/**
 * Anchor this stack at its list screen so cross-tab / deep-link navigation
 * into a booking always leaves a back path to the bookings list.
 */
export const unstable_settings = { initialRouteName: "index" };

export default function BookingsLayout() {
  const { colors } = useTheme();

  return (
    <Stack
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
