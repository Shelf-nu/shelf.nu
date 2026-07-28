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
// why: deep import — the ./reminders barrel pulls in the org-context-using
// hook, and org-context imports this file; going straight to the service
// (which only touches the api client) avoids a require cycle.
import { clearAllBookingReminders } from "./reminders/service";
import { supabase } from "./supabase";

type AuthState = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
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
  // Tracks whether we last saw an authenticated session, so ANY transition
  // to signed-out (expiry, revocation, refresh failure — not only the
  // explicit signOut button) clears the previous account's scheduled
  // booking reminders. After such a transition every reconcile would 401
  // forever, and a later user of the device must not receive the previous
  // account's booking names.
  const hadSessionRef = useRef(false);

  useEffect(() => {
    // Listener FIRST, then the initial read: registering after getSession()
    // leaves a window where a sign-out/refresh event lands before the stale
    // initial session resolves and overwrites it (and the signed-out
    // transition — and its reminder cleanup — would be missed). Supabase
    // also emits INITIAL_SESSION on subscribe, which this ordering catches.
    let receivedAuthEvent = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      receivedAuthEvent = true;
      if (hadSessionRef.current && session === null) {
        void clearAllBookingReminders();
      }
      hadSessionRef.current = session !== null;
      setSession(session);
      setIsLoading(false);
    });

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        // An auth event is always fresher than this snapshot — never let a
        // stale restored session clobber it.
        if (receivedAuthEvent) return;
        hadSessionRef.current = session !== null;
        setSession(session);
      })
      .catch((err) => {
        if (__DEV__) console.error("Failed to restore session:", err);
      })
      .finally(() => {
        setIsLoading(false);
      });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    // Scheduled booking reminders belong to this account's session. After
    // sign-out every reconcile fetch would 401 forever, so the tracked
    // records could never heal — cancel and forget them all up front.
    await clearAllBookingReminders();
    await supabase.auth.signOut();
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
