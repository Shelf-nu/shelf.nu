/**
 * ConnectServerSheet — asks for an organisation's domain and connects the app
 * to that organisation's Shelf server.
 *
 * Enterprise customers run their own Shelf instance. Choosing one is a
 * deliberate act performed BEFORE signing in, so that the whole login — password
 * or SSO — happens against a single server. Nothing else in the app infers a
 * server from what the user typed elsewhere.
 *
 * Every failure is shown here rather than swallowed: a domain nobody
 * recognises, a server that cannot be reached, a version mismatch. Only
 * `update_required` offers a store link, because it is the one failure a retry
 * can never fix.
 *
 * Follows the house selection-flow contract (TeamMemberPicker/LocationPicker):
 * `<Modal animationType="slide" presentationStyle="pageSheet">` + SafeAreaView
 * + header-with-close.
 *
 * @see {@link file://../lib/server/discovery.ts} `resolveServerForDomain`
 * @see {@link file://../app/(auth)/login.tsx} the primary entry point
 */
import { useReducer, useRef } from "react";
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { openAppStore } from "@/lib/app-update";
import { resolveServerForDomain, type ServerConfig } from "@/lib/server";

/**
 * The sheet's state machine: idle → connecting → (closed | error).
 *
 * One reducer rather than four `useState`s because every transition moves
 * several fields at once — starting a connection clears the previous error and
 * the update prompt, and a failure sets both together.
 */
type State = {
  domain: string;
  isConnecting: boolean;
  error: string | null;
  /** Whether the failure was this build being too old, which a retry cannot fix. */
  updateRequired: boolean;
};

type Action =
  | { type: "reset" }
  | { type: "domain_changed"; value: string }
  | { type: "connect_started" }
  | { type: "connect_failed"; message: string; updateRequired: boolean };

const INITIAL_STATE: State = {
  domain: "",
  isConnecting: false,
  error: null,
  updateRequired: false,
};

/**
 * Applies one transition of the sheet's state machine.
 *
 * @param state - Current state.
 * @param action - The transition to apply.
 * @returns The next state.
 */
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return INITIAL_STATE;
    case "domain_changed":
      // Typing clears the previous failure: the message described a different
      // domain, and leaving it up reads as a verdict on what is now typed.
      return {
        ...state,
        domain: action.value,
        error: null,
        updateRequired: false,
      };
    case "connect_started":
      return {
        ...state,
        isConnecting: true,
        error: null,
        updateRequired: false,
      };
    case "connect_failed":
      return {
        ...state,
        isConnecting: false,
        error: action.message,
        updateRequired: action.updateRequired,
      };
  }
}

type Props = {
  /** Whether the sheet is shown. */
  visible: boolean;
  /**
   * Whether to warn that connecting ends the current session. True when opened
   * from Settings; false on the login screen, where there is no session to lose.
   */
  warnSignOut?: boolean;
  /** Called with the connected server once the switch has completed. */
  onConnected: (server: ServerConfig) => void;
  /** Called when the user dismisses the sheet without connecting. */
  onClose: () => void;
};

/**
 * Domain-entry sheet for connecting to a private Shelf server.
 *
 * @param props - See {@link Props}.
 * @returns The modal sheet.
 */
export default function ConnectServerSheet({
  visible,
  warnSignOut = false,
  onConnected,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const inputRef = useRef<TextInput>(null);

  const [{ domain, isConnecting, error, updateRequired }, dispatch] =
    useReducer(reducer, INITIAL_STATE);

  /**
   * Immediate lock for the connect action — a state flag cannot block a second
   * tap in the same tick, and the lookup can take up to 15s with the button
   * still on screen.
   */
  const connectPendingRef = useRef(false);

  /**
   * Clears the sheet on the way out, so a previous failure never greets the
   * next attempt.
   *
   * Done here rather than in an effect watching `visible`: resetting on OPEN
   * would repaint mid-animation, flashing the old error while the sheet slides
   * in. Every path that closes the sheet goes through this or
   * {@link handleConnect}'s success branch.
   */
  const closeAndReset = () => {
    // Refused mid-connect. `resolveServerForDomain` commits the switch before
    // it returns, so dismissing here would not cancel anything — the user would
    // simply be signed out and moved to another server moments after choosing
    // not to. The close affordances are disabled to match.
    if (connectPendingRef.current) return;
    dispatch({ type: "reset" });
    onClose();
  };

  const handleConnect = async () => {
    if (connectPendingRef.current) return;
    connectPendingRef.current = true;
    dispatch({ type: "connect_started" });

    try {
      const outcome = await resolveServerForDomain(domain);
      if (outcome.ok) {
        dispatch({ type: "reset" });
        onConnected(outcome.server);
        return;
      }
      dispatch({
        type: "connect_failed",
        message: outcome.message,
        updateRequired: outcome.reason === "update_required",
      });
    } finally {
      connectPendingRef.current = false;
    }
  };

  const canConnect = domain.trim().length > 0 && !isConnecting;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={closeAndReset}
      // why: imperative focus once the sheet has actually presented — an
      // autoFocus prop fires before the modal animation and misses the keyboard.
      onShow={() => inputRef.current?.focus()}
    >
      <SafeAreaView style={styles.container} accessibilityViewIsModal={true}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Connect to a server</Text>
          <TouchableOpacity
            onPress={closeAndReset}
            disabled={isConnecting}
            style={[styles.closeButton, isConnecting && styles.buttonDisabled]}
            accessibilityLabel="Close connect to a server"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <Text style={styles.subtitle}>
            If your organization runs its own Shelf server, tell us who you are
            and we&apos;ll connect this app to it.
          </Text>

          <Text style={styles.label}>Your organization</Text>
          <TextInput
            testID="connect-domain-input"
            ref={inputRef}
            style={[styles.input, error ? styles.inputError : null]}
            value={domain}
            onChangeText={(value) =>
              dispatch({ type: "domain_changed", value })
            }
            placeholder="acme.com"
            placeholderTextColor={colors.placeholderText}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={canConnect ? handleConnect : undefined}
            editable={!isConnecting}
            accessibilityLabel="Your organization"
          />
          {/* All three resolve, so name all three: someone who knows only their
              server address should not have to guess at their email domain. */}
          <Text style={styles.hint}>
            Your work email, your company&apos;s domain, or your Shelf server
            address.
          </Text>

          {error && (
            <Text
              style={styles.errorText}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
            >
              {error}
            </Text>
          )}

          {/* Retrying can never fix a too-old build, so offer the store rather
              than leaving the user to guess. */}
          {updateRequired && (
            <TouchableOpacity
              testID="connect-update-app-button"
              style={styles.updateButton}
              onPress={openAppStore}
              activeOpacity={0.8}
              accessibilityLabel="Update Shelf in the app store"
              accessibilityRole="button"
            >
              <Text style={styles.updateButtonText}>Update Shelf</Text>
            </TouchableOpacity>
          )}

          {warnSignOut && (
            <Text style={styles.warning}>
              Connecting to a different server signs you out of this one.
            </Text>
          )}

          <TouchableOpacity
            testID="connect-server-button"
            style={[styles.button, !canConnect && styles.buttonDisabled]}
            onPress={handleConnect}
            disabled={!canConnect}
            activeOpacity={0.8}
            accessibilityLabel="Connect to this server"
            accessibilityRole="button"
          >
            {isConnecting ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.buttonText}>Connect</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: "600",
    color: colors.foreground,
  },
  closeButton: {
    padding: spacing.xs,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.lg,
    color: colors.foregroundSecondary,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.foregroundSecondary,
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: fontSize.lg,
    color: colors.foreground,
    ...shadows.sm,
  },
  inputError: {
    borderColor: colors.error,
  },
  hint: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.error,
    marginTop: spacing.xs,
  },
  warning: {
    fontSize: fontSize.sm,
    color: colors.foregroundSecondary,
    marginTop: spacing.xs,
  },
  updateButton: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: spacing.xs,
    ...shadows.sm,
  },
  updateButtonText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.foreground,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: spacing.md,
    ...shadows.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.primaryForeground,
  },
}));
