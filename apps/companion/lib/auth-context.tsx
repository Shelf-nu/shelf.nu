import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  endSessionOnDevice,
  getServerVersion,
  runBeforeSessionEnd,
  subscribeToServerChange,
} from "./server";
import { reportSignOutIncomplete } from "./sentry";
import {
  allowStoredSession,
  blockStoredSession,
  currentSessionStorageKey,
  getSupabase,
  getSupabaseClientUrl,
  persistedSessionRemover,
} from "./supabase";

type AuthState = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  /**
   * Signs in with a password against the ACTIVE server.
   *
   * Which server that is was decided earlier and explicitly, through the
   * connect flow; nothing here inspects the email to choose one.
   */
  signIn: (
    email: string,
    password: string
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  /** Counts sign-ins, so a sign-out can tell whether one happened meanwhile. */
  const signInsRef = useRef(0);

  // Changes whenever the app switches servers. The session effect below keys
  // off it so it re-reads and re-subscribes against the REBUILT Supabase
  // client — a `[]` dep array would leave it bound to the discarded one.
  const [serverVersion, setServerVersion] = useState(() => getServerVersion());

  useEffect(
    () => subscribeToServerChange(() => setServerVersion(getServerVersion())),
    []
  );

  useEffect(() => {
    const client = getSupabase();

    // Restoring a session is asynchronous, and connecting to another server
    // rebuilds the client while that read is still in flight. Whatever the
    // OUTGOING client answers describes a server the app has already left, so
    // it must not reach state: it would show the user as signed in to an
    // instance that every subsequent request now bypasses. The re-run for the
    // new server reports its own session and its own loading state.
    let isCurrentServer = true;

    client.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (isCurrentServer) setSession(session);
      })
      .catch((err) => {
        if (__DEV__) console.error("Failed to restore session:", err);
      })
      .finally(() => {
        if (isCurrentServer) setIsLoading(false);
      });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      // A forced sign-out stops background token refresh; every sign-in
      // starts it again.
      if (event === "SIGNED_IN") {
        signInsRef.current += 1;
        void client.auth.startAutoRefresh();
      }
      setSession(session);
    });

    return () => {
      isCurrentServer = false;
      subscription.unsubscribe();
    };
  }, [serverVersion]);

  const signIn = useCallback(async (email: string, password: string) => {
    // Authenticates against the ACTIVE server, whichever that is. Choosing the
    // server is a separate, explicit act (`resolveServerForDomain`), so nothing
    // here inspects the email — a login is only ever sent where the user
    // already connected the app.
    //
    // A session a past sign-out could not delete is refused on read; the new
    // one is written under the same key, so lift that block first.
    const serverAtStart = getServerVersion();
    const restoreBlock = await allowStoredSession();
    if (getServerVersion() !== serverAtStart) {
      await restoreBlock();
      return { error: "The server changed during sign-in. Please try again." };
    }
    try {
      const { error } = await getSupabase().auth.signInWithPassword({
        email,
        password,
      });
      if (error) await restoreBlock();
      return { error: error?.message ?? null };
    } catch (cause) {
      await restoreBlock();
      throw cause;
    }
  }, []);

  // Signing out deliberately KEEPS the active server: the user almost always
  // signs back into the same instance, and re-entering the domain every time
  // would be busywork. Returning to Shelf Cloud is an explicit action,
  // `disconnectFromServer`, surfaced on the login screen and in Settings.
  //
  // The before-session-end tasks run first, while the token still works: they
  // forget this device for push, so a shared phone stops receiving the
  // previous person's notifications.
  //
  // Sign-out always ends the session on the phone, even when the server cannot
  // be reached: `endSessionOnDevice` falls back to a local teardown and, if
  // that fails too, deletes the stored session itself. That last step emits no
  // auth event, so the signed-in state is cleared here as well, which sends the
  // person to the login screen with nothing to explain.
  const signOut = useCallback(async () => {
    // Bound to the session being signed out before anything awaits: a server
    // switch while the before-session-end tasks run must not make this
    // teardown act on the new server's client or session.
    const client = getSupabase();
    const removeStoredSession = persistedSessionRemover();
    const serverAtStart = getServerVersion();
    const serverUrlAtStart = getSupabaseClientUrl();
    const storageKeyAtStart = currentSessionStorageKey();
    const signInsAtStart = signInsRef.current;

    await runBeforeSessionEnd();
    const outcome = await endSessionOnDevice(client, removeStoredSession, {
      stillCurrent: () => getServerVersion() === serverAtStart,
    });
    if (outcome === "incomplete") {
      // The stored session survived every delete: refuse it from now on, so
      // a restart cannot restore the previous person.
      if (storageKeyAtStart) await blockStoredSession(storageKeyAtStart);
      reportSignOutIncomplete(serverUrlAtStart);
    }

    // A forced sign-out emits no auth event, so the state is cleared here,
    // unless someone signed in or the server changed while it ran.
    if (
      signInsRef.current === signInsAtStart &&
      getServerVersion() === serverAtStart
    ) {
      setSession(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      isLoading,
      signIn,
      signOut,
    }),
    [session, isLoading, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
