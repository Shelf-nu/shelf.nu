import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getServerVersion, subscribeToServerChange } from "./server";
import { getSupabase } from "./supabase";

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
    } = client.auth.onAuthStateChange((_event, session) => {
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
    const { error } = await getSupabase().auth.signInWithPassword({
      email,
      password,
    });
    return { error: error?.message ?? null };
  }, []);

  // Signing out deliberately KEEPS the active server: the user almost always
  // signs back into the same instance, and re-entering the domain every time
  // would be busywork. Returning to Shelf Cloud is an explicit action —
  // `disconnectFromServer`, surfaced on the login screen and in Settings.
  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
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
