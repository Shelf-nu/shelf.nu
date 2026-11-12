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
  signOutMayClearState,
  runBeforeSessionEnd,
  subscribeToServerChange,
} from "./server";
import { reportSignOutIncomplete } from "./sentry";
import {
  blockStoredSession,
  currentSessionStorageKey,
  getSupabase,
  getSupabaseClientUrl,
  persistedSessionRemover,
  prepareStoredSessionForSignIn,
} from "./supabase";
import { signInWithPreparedSession } from "./session-storage";

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

  // The client the session state below belongs to. A server switch that
  // rebuilds it starts from a clean, loading state: a forced teardown emits no
  // SIGNED_OUT, so the outgoing session would otherwise stay on screen against
  // the new server until the new client answers. A notice that keeps the
  // client (a rename, refreshed sign-in options) changes no session.
  const sessionClientRef = useRef(getSupabase());

  useEffect(
    () =>
      subscribeToServerChange(() => {
        const client = getSupabase();
        if (client !== sessionClientRef.current) {
          sessionClientRef.current = client;
          setSession(null);
          setIsLoading(true);
        }
        setServerVersion(getServerVersion());
      }),
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
    // A session a past sign-out could not delete stays refused until it is
    // verifiably removed (`prepareStoredSessionForSignIn`).
    const serverAtStart = getServerVersion();
    return signInWithPreparedSession({
      prepare: prepareStoredSessionForSignIn,
      serverUnchanged: () => getServerVersion() === serverAtStart,
      signIn: async () => {
        const { error } = await getSupabase().auth.signInWithPassword({
          email,
          password,
        });
        return { error: error?.message ?? null };
      },
    });
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
  // Sign-out always clears the signed-in state here, so the person reaches the
  // login screen even when the server cannot be reached. `endSessionOnDevice`
  // tries a server revoke, then a local sign-out, then deletes the stored
  // session itself; a forced delete emits no auth event, which is why the state
  // is cleared here. When the stored session cannot be confirmed gone, it is
  // blocked from being restored ("incomplete"), or blocked only for this app
  // run when the block cannot be stored ("unprotected"), and both are reported.
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
      // A stored session that survives every delete is refused from then on,
      // so a restart cannot restore the previous person.
      blockStoredSession: async () =>
        storageKeyAtStart ? blockStoredSession(storageKeyAtStart) : false,
    });
    if (outcome === "incomplete" || outcome === "unprotected") {
      reportSignOutIncomplete(serverUrlAtStart, {
        blockStored: outcome === "incomplete",
      });
    }

    // A forced sign-out emits no auth event, so the state is cleared here,
    // unless someone signed in or the server changed while it ran.
    if (
      signOutMayClearState(
        { signIns: signInsAtStart, serverVersion: serverAtStart },
        { signIns: signInsRef.current, serverVersion: getServerVersion() }
      )
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
