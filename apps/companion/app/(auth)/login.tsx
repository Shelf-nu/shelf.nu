import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { signInViaWeb } from "@/lib/web-auth";
import { getApiBaseUrl } from "@/lib/api";
import {
  disconnectFromServer,
  getActiveServer,
  subscribeToServerChange,
} from "@/lib/server";
import ConnectServerSheet from "@/components/connect-server-sheet";
import ShelfIcon from "@/components/brand/shelf-icon";
import ShelfWordmark from "@/components/brand/shelf-wordmark";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSsoSubmitting, setIsSsoSubmitting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isConnectVisible, setIsConnectVisible] = useState(false);
  /** Immediate lock for the reset link — state cannot block a same-tick retap. */
  const resetPendingRef = useRef(false);
  const router = useRouter();
  const params = useLocalSearchParams<{ error?: string }>();

  // Which Shelf server we're connected to. The connect sheet can switch this
  // while the screen is mounted, so it must re-render rather than be read once.
  const [server, setServer] = useState(() => getActiveServer());
  useEffect(
    () => subscribeToServerChange(() => setServer(getActiveServer())),
    []
  );

  // Surface a sign-in error passed via navigation — e.g. an SSO exchange failure
  // that resolved while the auth-callback route was covering this screen on Android
  // (see handleSsoLogin), or the auth-callback timeout backstop.
  useEffect(() => {
    if (params.error) {
      setError(String(params.error));
    }
  }, [params.error]);

  // ── iOS credential autofill detection ──────────────────────────────
  // Face ID autofill sets each field exactly once (count=1).
  // Manual typing fires onChangeText per keystroke (count >> 1).
  // When both fields fill with count=1, auto-submit so the user
  // doesn't have to scroll down and tap "Sign In" after Face ID.
  const changeCountRef = useRef({ email: 0, password: 0 });
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Mirrors `isSsoSubmitting` so deferred callers (the auto-submit timer) can
   * read the CURRENT value rather than the one captured when they were armed.
   */
  const isSsoSubmittingRef = useRef(false);
  isSsoSubmittingRef.current = isSsoSubmitting;

  useEffect(() => {
    // isSsoSubmitting is a dependency so that starting SSO re-runs this effect
    // and its cleanup CANCELS a pending auto-submit timer. Without it the timer
    // survives, and the 500ms-later callback carries the isSsoSubmitting=false
    // captured by the render that armed it — so the guard inside handleLogin
    // reads a stale false and signs in underneath the SSO exchange.
    if (
      !email.trim() ||
      !password ||
      isSubmitting ||
      isSsoSubmitting ||
      isResetting
    )
      return;

    const { email: ec, password: pc } = changeCountRef.current;
    if (ec === 1 && pc === 1) {
      autoSubmitTimerRef.current = setTimeout(handleLogin, 500);
    }

    return () => {
      if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
    };
    // why: handleLogin is defined inline below and recreated each render; including it
    // in deps would cause the effect to re-fire on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password, isSubmitting, isSsoSubmitting, isResetting]);

  const handleLogin = async () => {
    Keyboard.dismiss();
    setError(null);

    // why: the disabled prop covers the button, but not the password field's
    // onSubmitEditing nor the Face ID auto-submit effect. A password sign-in
    // starting mid-SSO would switch servers under the in-flight exchange.
    // Read through the ref, not the state: a deferred caller (the auto-submit
    // timer) holds the value from the render that created this closure.
    if (isSsoSubmittingRef.current || resetPendingRef.current) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Please enter both email and password.");
      return;
    }

    setIsSubmitting(true);
    const { error: signInError } = await signIn(trimmedEmail, password);
    setIsSubmitting(false);

    if (signInError) {
      setError(signInError);
    }
  };

  const handleSsoLogin = async () => {
    Keyboard.dismiss();
    setError(null);

    // why: clear the autofill counters before flipping the flag. Otherwise a
    // FAILED SSO flips isSsoSubmitting back to false, the auto-submit effect
    // re-runs with the counts still at {1,1}, and the user gets a surprise
    // password sign-in 500ms after explicitly choosing SSO.
    changeCountRef.current = { email: 0, password: 0 };

    setIsSsoSubmitting(true);
    // Opens the web SSO flow in the system browser; resolves once the app
    // receives the callback and installs the session (or the user cancels).
    const { error: ssoError } = await signInViaWeb();
    setIsSsoSubmitting(false);
    if (ssoError) {
      // On Android the auth-callback route is mounted on top of this screen while
      // the exchange runs, so a plain setError would be hidden — the user would sit
      // on the "Signing you in…" spinner until the 20s timeout bounced them to a
      // fresh, error-less login. Replace that route with login carrying the error so
      // the failure shows immediately. On iOS the exchange resolves in-frame (no
      // auth-callback on the stack), so just set the error on the visible screen.
      if (Platform.OS === "android") {
        router.replace({
          pathname: "/(auth)/login",
          params: { error: ssoError },
        });
      } else {
        setError(ssoError);
      }
    }
  };

  /**
   * Opens the web password-reset flow in an in-app browser — the same
   * `WebBrowser` session the SSO button uses, so the web takes over *inside* the
   * app (SFSafariViewController on iOS / Custom Tab on Android) instead of
   * kicking the user out to the external browser. The web `/forgot-password` OTP
   * flow is the source of truth and rejects SSO users server-side; the in-app
   * sheet survives the user switching to their mail app for the code and back.
   */
  const handleForgotPassword = async () => {
    Keyboard.dismiss();
    setError(null);
    if (isSubmitting || isSsoSubmitting) return;
    // why: the ref is what actually serializes. Presenting the in-app browser
    // is async with no visible feedback until it appears, which is exactly when
    // a user taps again — and a state flag cannot block a second tap in the
    // same tick.
    if (resetPendingRef.current) return;
    resetPendingRef.current = true;
    setIsResetting(true);

    try {
      // Opens the ACTIVE server's reset page — the same server the user would
      // be signing in to. Nothing is resolved here: the server was chosen
      // explicitly via the connect sheet, and re-deriving it from a
      // half-typed email is what the old design got wrong.
      // Awaited inside the lock so it spans the presentation: releasing while
      // the sheet is still opening would let a second tap hit expo-web-browser's
      // "already presenting" rejection and paint a misleading error.
      await WebBrowser.openBrowserAsync(`${getApiBaseUrl()}/forgot-password`);
    } catch {
      setError("Couldn't open the password reset page. Please try again.");
    } finally {
      resetPendingRef.current = false;
      setIsResetting(false);
    }
  };

  // Sign-in methods this server actually offers. A server advertising NEITHER
  // is misconfigured, and a screen with no way in is a worse failure than a
  // control that turns out not to work — so that case shows both.
  const offersNeither = !server.ssoEnabled && !server.passwordLoginEnabled;
  const showPassword = server.passwordLoginEnabled || offersNeither;
  const showSso = server.ssoEnabled || offersNeither;

  /**
   * Returns the app to Shelf Cloud.
   *
   * No confirmation: this screen is only reachable when signed out, so there is
   * no session to lose. Settings, where a session DOES exist, confirms first.
   */
  const handleDisconnect = async () => {
    setError(null);
    await disconnectFromServer();
  };

  return (
    <Pressable
      style={{ flex: 1 }}
      onPress={Keyboard.dismiss}
      accessible={false}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {/* ── Brand Section ─────────────────────────────────────── */}
          <View style={styles.brand}>
            <ShelfIcon size={72} />
            <View style={styles.wordmarkWrap}>
              <ShelfWordmark width={100} color={colors.foreground} />
            </View>
            {/* Only for a non-cloud server: on Shelf Cloud the chip would be
                noise on every user's login screen. It is also the only place a
                user can tell which server they are about to hand credentials
                to, so it must stay visible rather than being tucked away. */}
            {!server.isCloud && (
              <View style={styles.serverChip}>
                <Text style={styles.serverChipText}>
                  Connected to {server.name}
                </Text>
                <TouchableOpacity
                  testID="disconnect-server-button"
                  onPress={handleDisconnect}
                  disabled={isSubmitting || isSsoSubmitting || isResetting}
                  accessibilityLabel={`Disconnect from ${server.name} and return to Shelf Cloud`}
                  accessibilityRole="button"
                >
                  <Text style={styles.serverChipAction}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* ── Welcome Text ──────────────────────────────────────── */}
          <View style={styles.welcomeSection}>
            <Text style={styles.welcomeTitle}>Welcome back</Text>
            <Text style={styles.welcomeSubtitle}>Sign in to your account</Text>
          </View>

          {/* ── Form ──────────────────────────────────────────────── */}
          <View style={styles.form}>
            {showPassword && (
              <>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  testID="email-input"
                  style={[styles.input, error ? styles.inputError : null]}
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    setError(null);
                    changeCountRef.current.email++;
                  }}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.placeholderText}
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  blurOnSubmit={false}
                  editable={!isSubmitting && !isSsoSubmitting}
                  accessibilityLabel="Email"
                />

                <Text style={styles.label}>Password</Text>
                <TextInput
                  testID="password-input"
                  ref={passwordRef}
                  style={[styles.input, error ? styles.inputError : null]}
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    setError(null);
                    changeCountRef.current.password++;
                  }}
                  placeholder="Your password"
                  placeholderTextColor={colors.placeholderText}
                  secureTextEntry
                  // why: without this iOS applies its default sentence-casing to the
                  // first character, silently sending "Trixie01" for "trixie01" and
                  // failing login for any password that starts with a lowercase
                  // letter. The email field already guards against this.
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={handleLogin}
                  editable={!isSubmitting && !isSsoSubmitting}
                  accessibilityLabel="Password"
                />
              </>
            )}

            {error && (
              <Text
                style={styles.errorText}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                {error}
              </Text>
            )}

            {showPassword && (
              <>
                <TouchableOpacity
                  testID="forgot-password-link"
                  style={[
                    styles.forgotLink,
                    (isSubmitting || isSsoSubmitting || isResetting) &&
                      styles.buttonDisabled,
                  ]}
                  onPress={handleForgotPassword}
                  disabled={isSubmitting || isSsoSubmitting || isResetting}
                  activeOpacity={0.7}
                  accessibilityLabel="Forgot your password? Reset it on the web"
                  accessibilityRole="link"
                >
                  <Text style={styles.forgotText}>Forgot password?</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  testID="sign-in-button"
                  style={[
                    styles.button,
                    (isSubmitting || isSsoSubmitting || isResetting) &&
                      styles.buttonDisabled,
                  ]}
                  onPress={handleLogin}
                  disabled={isSubmitting || isSsoSubmitting || isResetting}
                  activeOpacity={0.8}
                  accessibilityLabel={
                    isSubmitting ? "Signing in" : "Sign in to your account"
                  }
                  accessibilityRole="button"
                >
                  {isSubmitting ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={styles.buttonText}>Sign In</Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            {showSso && (
              <>
                {/* The divider only separates two things. */}
                {showPassword && (
                  <View style={styles.divider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>or</Text>
                    <View style={styles.dividerLine} />
                  </View>
                )}

                <TouchableOpacity
                  testID="sso-sign-in-button"
                  style={[
                    styles.ssoButton,
                    (isSubmitting || isSsoSubmitting || isResetting) &&
                      styles.buttonDisabled,
                  ]}
                  onPress={handleSsoLogin}
                  disabled={isSubmitting || isSsoSubmitting || isResetting}
                  activeOpacity={0.8}
                  accessibilityLabel="Sign in with SSO"
                  accessibilityRole="button"
                >
                  {isSsoSubmitting ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Text style={styles.ssoButtonText}>Sign in with SSO</Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              testID="connect-server-link"
              style={[
                styles.connectLink,
                (isSubmitting || isSsoSubmitting || isResetting) &&
                  styles.buttonDisabled,
              ]}
              onPress={() => setIsConnectVisible(true)}
              disabled={isSubmitting || isSsoSubmitting || isResetting}
              activeOpacity={0.7}
              accessibilityLabel="Connect to a private Shelf server"
              accessibilityRole="button"
            >
              <Text style={styles.connectLinkText}>
                {server.isCloud
                  ? "Connect to a private server"
                  : "Connect to a different server"}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.footer}>
            Use the same credentials as your Shelf web account.
          </Text>
        </ScrollView>

        <ConnectServerSheet
          visible={isConnectVisible}
          onClose={() => setIsConnectVisible(false)}
          onConnected={() => {
            setIsConnectVisible(false);
            setError(null);
          }}
        />
      </KeyboardAvoidingView>
    </Pressable>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
  },
  brand: {
    alignItems: "center",
    marginBottom: spacing.xxxl,
  },
  wordmarkWrap: {
    marginTop: spacing.md,
  },
  // borderLight/gray700 is the pair the DRAFT status badge already uses, so it
  // is theme-aware and vetted for WCAG 2.1 AA contrast in light and dark.
  serverChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.borderLight,
  },
  serverChipText: {
    fontSize: fontSize.sm,
    color: colors.gray700,
    fontWeight: "500",
  },
  serverChipAction: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.primary,
  },
  connectLink: {
    alignSelf: "center",
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  connectLinkText: {
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.foregroundSecondary,
  },
  welcomeSection: {
    alignItems: "center",
    marginBottom: spacing.xxxl,
  },
  welcomeTitle: {
    fontSize: fontSize.xxxl,
    fontWeight: "700",
    color: colors.foreground,
  },
  welcomeSubtitle: {
    fontSize: fontSize.md,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  form: {
    gap: spacing.xs,
  },
  label: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.gray700,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: fontSize.lg,
    color: colors.foreground,
    backgroundColor: colors.white,
    ...shadows.sm,
  },
  inputError: {
    borderColor: colors.error,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
  },
  forgotLink: {
    alignSelf: "flex-end",
    marginTop: spacing.sm,
  },
  forgotText: {
    fontSize: fontSize.sm,
    color: colors.buttonGhostText,
    fontWeight: "500",
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: spacing.xl,
    ...shadows.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.primaryForeground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.gray300,
  },
  dividerText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  ssoButton: {
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.xl,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: spacing.xl,
    backgroundColor: colors.white,
    ...shadows.sm,
  },
  ssoButtonText: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  footer: {
    textAlign: "center",
    color: colors.mutedLight,
    fontSize: fontSize.sm,
    marginTop: spacing.xxxl,
  },
}));
