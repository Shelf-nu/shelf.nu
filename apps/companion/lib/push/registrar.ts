/**
 * The push registrar: registers this device for the signed-in person, and
 * forgets it on sign-out.
 *
 * Registration is idempotent. Callers fire it from several triggers (a
 * session appearing, the explainer's tap, a token change, the app returning
 * to the foreground) and each run converges on the same server state: a run
 * that finds a current {@link PushTokenRecord} sends nothing, and a run after
 * a failure waits out a growing interval first. Background runs happen only
 * once the person opted in on this phone. Runs queue behind each other.
 *
 * Sign-out never waits for that queue. It aborts the run in flight, its POST
 * included, so no POST outlives sign-out, and sends the DELETE with the
 * session that is about to end. The DELETE names the stored token and the
 * token the aborted POST carried, since the server may have applied that POST
 * before the abort reached it, and leaves once the POST has settled, which the
 * abort makes immediate. The stored token is sent only when it was registered
 * for the same person on the active server: no other server can remove it,
 * and another server's 404 says nothing about the one that holds it. The
 * record is removed once the server acknowledges the DELETE. A failed DELETE
 * keeps the registration, marked unconfirmed, so it still says which token
 * the server may hold and the next registration sends it again. The session
 * that signed out is never registered again.
 *
 * The registrar is one explicit state, `idle`, `registering` or
 * `unregistering`, rather than a chain of promises, so each decision reads
 * the state it depends on.
 *
 * Every native and network call arrives through {@link RegistrarEffects}, so
 * this module stays pure (no React Native, Expo or `@/` imports) and
 * `node:test` drives it with a fake phone. `./registration.ts` supplies the
 * real effects.
 *
 * @see {@link file://./registrar.test.ts}
 * @see {@link file://./token-record.ts} the record and its backoff
 */
import type { PushPermission } from "./preferences";
import {
  isBackingOff,
  isRegistrationCurrent,
  isRegistrationFor,
  withFailure,
  withoutFailure,
  withRegistration,
  withRemovalUnconfirmed,
  type PushFailureStage,
  type PushTokenRecord,
  type RegistrationFailureStage,
} from "./token-record";

/** How long sign-out waits for the server to forget this device. */
export const UNREGISTER_TIMEOUT_MS = 3_000;

/** The signed-in session, as far as registration needs it. */
export type PushSession = {
  userId: string;
  /** Identifies this session: a new sign-in gets a new one. */
  accessToken: string;
};

/** A Shelf server answer to a push token request. */
export type PushApiAnswer =
  | { kind: "ok" }
  /** The server answered with an error status. */
  | { kind: "rejected"; status: number; message: string }
  /** No answer: offline, timed out, or no usable session. */
  | { kind: "unreachable"; message: string }
  /** The caller aborted the request. */
  | { kind: "aborted" };

/**
 * The calls the registrar makes outside itself. Storage and session reads
 * never throw (they answer null or false instead); the permission and token
 * calls may, and their failures are attributed to their stage.
 *
 * @template Reported - A device token the OS reported through its listener
 */
export type RegistrarEffects<Reported> = {
  getSession: () => Promise<PushSession | null>;
  /** Origin of the active server. */
  getBaseUrl: () => string;
  readRecord: () => Promise<PushTokenRecord | null>;
  /** Stores the record, or removes it for null. */
  writeRecord: (record: PushTokenRecord | null) => Promise<void>;
  /** Whether the person turned notifications on on this phone. */
  readOptedIn: () => Promise<boolean>;
  readPermission: () => Promise<PushPermission>;
  /** The device token string inside a reported token. */
  deviceTokenOf: (reported: Reported) => string;
  /**
   * Gets this device's APNs or FCM token (or uses the reported one) and the
   * Expo token minted from it. Rejects when the signal aborts.
   */
  fetchTokens: (
    reported: Reported | undefined,
    signal: AbortSignal
  ) => Promise<{ token: string; deviceToken: string }>;
  /**
   * `POST /api/mobile/push-token`. Never throws, and answers `aborted` once
   * the signal aborts.
   */
  postToken: (token: string, signal: AbortSignal) => Promise<PushApiAnswer>;
  /** `DELETE /api/mobile/push-token`. Never throws. */
  deleteToken: (token: string, signal: AbortSignal) => Promise<PushApiAnswer>;
  /** Reports a failure to Sentry. */
  report: (stage: PushFailureStage, message: string) => void;
  /** The current time in epoch milliseconds. */
  now: () => number;
};

/** What one registration run did. */
export type RegistrationOutcome =
  | "registered"
  /** The stored record already covers this person, server and device. */
  | "current"
  /** A background run on a phone whose person never opted in. */
  | "not-opted-in"
  /** A background run inside the wait after a failure. */
  | "backing-off"
  | "no-permission"
  /** Nobody is signed in, or the session is ending. */
  | "signed-out"
  /** Push is not available on this platform (web). */
  | "unsupported"
  /** Sign-out stopped the run. */
  | "aborted"
  | "failed";

/** Options for one registration run. */
export type RegisterOptions<Reported> = {
  /**
   * A run the person asked for ("Turn on notifications", "Try again"): it
   * skips the opt-in check, the wait and the current-record check, and a
   * failure it meets starts the count again.
   */
  force?: boolean;
  /**
   * A device token the OS just reported; the run registers only when it
   * differs from the stored one.
   */
  reported?: Reported;
};

/** Registers and forgets this device. */
export type PushRegistrar<Reported> = {
  /**
   * Runs one registration after any already queued. Never throws.
   *
   * @returns What the run did
   */
  register: (
    options?: RegisterOptions<Reported>
  ) => Promise<RegistrationOutcome>;
  /**
   * Forgets this device on the server, for sign-out. Never throws, and
   * resolves within the time limit whatever the server does.
   */
  unregister: () => Promise<void>;
};

/** The run in flight, while it registers. */
type RegisteringRun = {
  kind: "registering";
  /** Aborted by sign-out. */
  controller: AbortController;
  /** The POST this run sent, once it sent it. */
  post: { token: string; answer: Promise<PushApiAnswer> } | null;
};

/** What the registrar is doing now. */
type RunState =
  | { kind: "idle" }
  | RegisteringRun
  | { kind: "unregistering"; done: Promise<void> };

/** How a sign-out ended. */
type ForgetResult = "forgotten" | "no-session" | { failed: string };

/** The message of a caught error. */
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Runs `work`, turning a throw into a message. */
async function settle<T>(
  work: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    return { ok: true, value: await work() };
  } catch (cause) {
    return { ok: false, message: messageOf(cause) };
  }
}

/** Resolves with `value` once the signal aborts. */
function onAbort<T>(signal: AbortSignal, value: T): Promise<T> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(value);
    else signal.addEventListener("abort", () => resolve(value));
  });
}

/** Whether the server no longer holds the token: removed, or never had it. */
function isAcknowledged(answer: PushApiAnswer): boolean {
  return (
    answer.kind === "ok" ||
    (answer.kind === "rejected" && answer.status === 404)
  );
}

/**
 * Creates a registrar. The app makes one, at module scope, in
 * `./registration.ts`.
 *
 * @param effects - The native and network calls
 * @param options.unregisterTimeoutMs - How long sign-out waits; defaults to
 *   {@link UNREGISTER_TIMEOUT_MS}
 * @returns The registrar
 */
export function createPushRegistrar<Reported>(
  effects: RegistrarEffects<Reported>,
  options: { unregisterTimeoutMs?: number } = {}
): PushRegistrar<Reported> {
  const unregisterTimeoutMs =
    options.unregisterTimeoutMs ?? UNREGISTER_TIMEOUT_MS;

  let state: RunState = { kind: "idle" };
  /** Tail of the queue registrations join. Sign-out never joins it. */
  let queue: Promise<unknown> = Promise.resolve();
  /** The access token of the last session that signed out. */
  let endedSession: string | null = null;
  /** Stages already reported to Sentry in this app session. */
  const reported = new Set<PushFailureStage>();

  /** Read through a call, so a check after an `await` sees the live state. */
  const isSigningOut = () => state.kind === "unregistering";

  const reportOnce = (stage: PushFailureStage, message: string) => {
    if (reported.has(stage)) return;
    reported.add(stage);
    effects.report(stage, message);
  };

  /** The steps of one run, once it holds the `registering` state. */
  const runSteps = async (
    session: PushSession,
    run: RegisteringRun,
    { force = false, reported: reportedToken }: RegisterOptions<Reported>
  ): Promise<RegistrationOutcome> => {
    const { signal } = run.controller;
    const audience = { userId: session.userId, baseUrl: effects.getBaseUrl() };
    const stored = await effects.readRecord();

    if (!force) {
      if (!(await effects.readOptedIn())) return "not-opted-in";
      const now = effects.now();
      if (isBackingOff(stored, audience, now)) return "backing-off";
      const deviceToken =
        reportedToken === undefined
          ? undefined
          : effects.deviceTokenOf(reportedToken);
      if (isRegistrationCurrent(stored, { ...audience, deviceToken }, now)) {
        return "current";
      }
    }
    const record = force ? withoutFailure(stored) : stored;

    const fail = async (
      stage: RegistrationFailureStage,
      message: string,
      serverLacksPush = false
    ): Promise<RegistrationOutcome> => {
      if (signal.aborted) return "aborted";
      await effects.writeRecord(
        withFailure(record, {
          stage,
          at: effects.now(),
          serverLacksPush,
          ...audience,
        })
      );
      // A server without the push route is a known state, not a fault.
      if (!serverLacksPush) reportOnce(stage, message);
      return "failed";
    };

    const permission = await settle(effects.readPermission);
    if (signal.aborted) return "aborted";
    if (!permission.ok) return fail("permission", permission.message);
    if (permission.value !== "granted") return "no-permission";

    const tokens = await settle(() =>
      effects.fetchTokens(reportedToken, signal)
    );
    if (signal.aborted) return "aborted";
    if (!tokens.ok) return fail("token", tokens.message);

    const { token, deviceToken } = tokens.value;
    const answer = effects.postToken(token, signal);
    run.post = { token, answer };
    const result = await answer;
    // Sign-out owns the server state from here: it forgets this token, which
    // the server may hold even when the abort cut the answer off.
    if (signal.aborted) return "aborted";

    switch (result.kind) {
      case "ok":
        await effects.writeRecord(
          withRegistration({
            token,
            deviceToken,
            ...audience,
            sentAt: effects.now(),
          })
        );
        return "registered";
      case "rejected":
        return fail("register", result.message, result.status === 404);
      case "unreachable":
        return fail("register", result.message);
      case "aborted":
        return "aborted";
    }
  };

  /** One run, from the head of the queue. */
  const runRegistration = async (
    options: RegisterOptions<Reported>
  ): Promise<RegistrationOutcome> => {
    if (isSigningOut()) return "signed-out";
    const session = await effects.getSession();
    if (!session || session.accessToken === endedSession) return "signed-out";
    // Sign-out may have started while the session was read.
    if (isSigningOut()) return "signed-out";

    const run: RegisteringRun = {
      kind: "registering",
      controller: new AbortController(),
      post: null,
    };
    state = run;
    try {
      return await runSteps(session, run, options);
    } catch {
      // The effects that may throw are settled above; this guards the rest.
      return "failed";
    } finally {
      if (state === run) state = { kind: "idle" };
    }
  };

  /** Sends the DELETE for every token the server may hold for this phone. */
  const forget = async (
    interrupted: RegisteringRun | null,
    deadline: AbortSignal
  ): Promise<ForgetResult> => {
    const session = await effects.getSession();
    if (!session) return "no-session";
    endedSession = session.accessToken;
    const audience = { userId: session.userId, baseUrl: effects.getBaseUrl() };

    // The abort settles the POST at once; waiting for it keeps the DELETE
    // from leaving while the POST is still on the wire.
    const post = interrupted?.post ?? null;
    if (post) await Promise.race([post.answer, onAbort(deadline, null)]);

    const record = await effects.readRecord();
    // A registration for another person or server stays as it is: the next
    // registration on its own server claims the token.
    const owned =
      record?.registration && isRegistrationFor(record, audience)
        ? record.registration
        : null;

    /** Keeps the owned registration, marked unconfirmed, and fails. */
    const unconfirmed = async (failed: string): Promise<ForgetResult> => {
      if (owned) {
        // Re-read: a registration that replaced this one is left alone.
        const latest = await effects.readRecord();
        if (
          latest?.registration?.token === owned.token &&
          latest.registration.sentAt === owned.sentAt
        ) {
          await effects.writeRecord(
            withRemovalUnconfirmed({ ...latest, registration: owned })
          );
        }
      }
      return { failed };
    };

    if (deadline.aborted) return unconfirmed("No answer before sign-out.");

    const tokens = [
      ...new Set(
        [owned?.token, post?.token].filter((token): token is string =>
          Boolean(token)
        )
      ),
    ];
    const answers = await Promise.all(
      tokens.map((token) => effects.deleteToken(token, deadline))
    );
    const refused = answers.find((answer) => !isAcknowledged(answer));
    if (refused) {
      return unconfirmed(
        refused.kind === "rejected" || refused.kind === "unreachable"
          ? refused.message
          : "No answer before sign-out."
      );
    }
    if (owned || !record?.registration) await effects.writeRecord(null);
    return "forgotten";
  };

  const unregister = (): Promise<void> => {
    if (state.kind === "unregistering") return state.done;

    const interrupted = state.kind === "registering" ? state : null;
    interrupted?.controller.abort();

    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), unregisterTimeoutMs);
    const done = Promise.race([
      forget(interrupted, deadline.signal),
      onAbort(deadline.signal, { failed: "No answer before sign-out." }),
    ])
      .then((result) => {
        if (typeof result === "object") reportOnce("unregister", result.failed);
      })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        state = { kind: "idle" };
      });
    state = { kind: "unregistering", done };
    return done;
  };

  const register = (
    options: RegisterOptions<Reported> = {}
  ): Promise<RegistrationOutcome> => {
    const run = queue.then(() => runRegistration(options));
    queue = run.catch(() => undefined);
    return run;
  };

  return { register, unregister };
}
