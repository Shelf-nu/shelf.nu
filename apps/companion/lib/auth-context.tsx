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
   * Signs in with a password, resolving the correct server first.
   *
   * `updateRequired` marks the one failure a retry cannot fix — this build is
   * too old for the target server — so the caller can offer a store link.
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
  const [serverVersion, setServerVersion] = useState(getServerVersion());

  useEffect(
    () => subscribeToServerChange(() => setServerVersion(getServerVersion())),
    []
  );

  useEffect(() => {
    const client = getSupabase();

    client.auth
      .getSession()
      .then(({ data: { session } }) => {
        setSession(session);
      })
      .catch((err) => {
        if (__DEV__) console.error("Failed to restore session:", err);
      })
      .finally(() => {
        setIsLoading(false);
      });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
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
