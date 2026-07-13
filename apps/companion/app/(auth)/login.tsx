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
import { API_BASE_URL } from "@/lib/api";
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
  const router = useRouter();
  const params = useLocalSearchParams<{ error?: string }>();

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

  useEffect(() => {
    if (!email.trim() || !password || isSubmitting) return;

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
  }, [email, password, isSubmitting]);

  const handleLogin = async () => {
    Keyboard.dismiss();
    setError(null);

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
  const handleForgotPassword = () => {
    Keyboard.dismiss();
    setError(null);
    WebBrowser.openBrowserAsync(`${API_BASE_URL}/forgot-password`).catch(() => {
      setError("Couldn't open the password reset page. Please try again.");
    });
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
          </View>

          {/* ── Welcome Text ──────────────────────────────────────── */}
          <View style={styles.welcomeSection}>
            <Text style={styles.welcomeTitle}>Welcome back</Text>
            <Text style={styles.welcomeSubtitle}>Sign in to your account</Text>
          </View>

          {/* ── Form ──────────────────────────────────────────────── */}
          <View style={styles.form}>
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
              editable={!isSubmitting}
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
              editable={!isSubmitting}
              accessibilityLabel="Password"
            />

            {error && (
              <Text
                style={styles.errorText}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                {error}
              </Text>
            )}

            <TouchableOpacity
              testID="forgot-password-link"
              style={styles.forgotLink}
              onPress={handleForgotPassword}
              activeOpacity={0.7}
              accessibilityLabel="Forgot your password? Reset it on the web"
              accessibilityRole="link"
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="sign-in-button"
              style={[styles.button, isSubmitting && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={isSubmitting}
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

            {/* ── SSO (web-delegated) ─────────────────────────────── */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              testID="sso-sign-in-button"
              style={[
                styles.ssoButton,
                (isSubmitting || isSsoSubmitting) && styles.buttonDisabled,
              ]}
              onPress={handleSsoLogin}
              disabled={isSubmitting || isSsoSubmitting}
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
          </View>

          <Text style={styles.footer}>
            Use the same credentials as your Shelf web account.
          </Text>
        </ScrollView>
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
