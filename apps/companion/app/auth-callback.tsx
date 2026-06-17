/**
 * SSO deeplink landing route.
 *
 * The web SSO flow finishes by redirecting to `shelf://auth-callback?code=…`.
 * On Android the in-app browser delivers that as a real deeplink, so Expo
 * Router routes here — without this file Expo Router would render its
 * "Unmatched Route" 404 mid-login. We do NOT run the code→session exchange
 * here: that is owned by `signInViaWeb` (the auth session that opened the
 * browser resolves with the callback URL and performs the exchange +
 * `setSession`). This route simply shows a "signing you in" spinner and, once
 * the session lands via `onAuthStateChange`, sends the user to their start page.
 *
 * On iOS the auth session intercepts the `shelf://` redirect internally, so this
 * route is never reached — it exists purely to absorb the Android deeplink.
 *
 * @see apps/companion/lib/web-auth.ts — opens the session, runs the exchange
 * @see apps/companion/app/_layout.tsx — root auth gating
 */
import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { getStartPage, getStartPageRoute } from "@/lib/start-page";

/**
 * Safety net: if the exchange never completes (network failure or an abandoned
 * sign-in), don't spin forever — fall back to the login screen. Set longer than
 * the exchange's own 15s abort in `signInViaWeb` so we never pre-empt a slow but
 * still-succeeding exchange.
 */
const SIGN_IN_TIMEOUT_MS = 20_000;

/**
 * Native SSO callback landing screen.
 *
 * Rendered while the web-auth exchange (owned by `signInViaWeb`) installs the
 * Supabase session. Shows a "Signing you in…" spinner, then redirects to the
 * user's start page once the session lands — or to `/(auth)/login` if sign-in
 * times out (see {@link SIGN_IN_TIMEOUT_MS}). Takes no props.
 *
 * @returns A `<Redirect>` once auth resolves or times out; the loading spinner
 *   otherwise.
 */
export default function AuthCallback() {
  const { session } = useAuth();
  const { colors } = useTheme();
  const [startRoute, setStartRoute] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    getStartPage().then((page) => setStartRoute(getStartPageRoute(page)));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), SIGN_IN_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  // Session landed (exchange succeeded) → into the app at the user's start page.
  if (session && startRoute) {
    return <Redirect href={startRoute as any} />;
  }

  // Session never landed (exchange stalled, or the user abandoned the flow) → back
  // to login. Carry a message so the bounce isn't silent — the common Android
  // failure is surfaced faster by handleSsoLogin; this is the backstop.
  if (timedOut) {
    return (
      <Redirect
        href={{
          pathname: "/(auth)/login",
          params: { error: "Sign-in timed out. Please try again." },
        }}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.label, { color: colors.foreground }]}>
        Signing you in…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: "500",
  },
});
