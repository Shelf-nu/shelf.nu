/**
 * Signup intent cookie
 *
 * Carries a {@link SignupIntent} from the signup page to the end of
 * onboarding. The intent is read from the `/join` URL once, and from there
 * every request in the signup flow (the password signup, the one-time-code
 * request, the code confirmation) re-issues the cookie so its window
 * restarts at each step rather than at the first page view. Onboarding
 * consumes it: stores what is worth keeping and clears the cookie.
 *
 * The cookie is signed with the session secret, so a value a browser (or a
 * person) has edited fails the signature and reads as "no intent". It also
 * carries its own expiry, so a replayed value past its window is ignored
 * even when the browser did not drop it. HttpOnly: nothing on the client
 * needs it.
 *
 * @see {@link file://./schema.ts} — what an intent is
 * @see {@link file://./../../routes/_auth+/join.tsx} — issues it
 * @see {@link file://./../../routes/_auth+/send-otp.tsx} — re-issues it
 * @see {@link file://./../../routes/_auth+/otp.tsx} — re-issues it
 * @see {@link file://./../../routes/_welcome+/onboarding.tsx} — consumes and clears it
 */
import { createCookie } from "react-router";
import { z } from "zod";
import { NODE_ENV, SESSION_SECRET } from "~/utils/env";
import { SignupIntentSchema, type SignupIntent } from "./schema";

/**
 * How long an intent stays valid after it was (re-)issued. Long enough to
 * find the confirmation email and fill in the onboarding form; short enough
 * that a stale link on a shared machine does not steer the next person.
 */
export const SIGNUP_INTENT_TTL_SECONDS = 30 * 60;

const COOKIE_NAME = "signup-intent";

/** The stored shape: the intent plus the moment it stops being trusted. */
const StoredSignupIntentSchema = SignupIntentSchema.extend({
  /** Epoch milliseconds after which the value is ignored. */
  expiresAt: z.number().int().positive(),
});

export const signupIntentCookie = createCookie(COOKIE_NAME, {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  secure: NODE_ENV === "production",
  secrets: [SESSION_SECRET],
  maxAge: SIGNUP_INTENT_TTL_SECONDS,
});

/**
 * Reads the intent carried by a request.
 *
 * @param request - The incoming request
 * @returns The intent, or `null` when the cookie is absent, tampered with,
 *   malformed, or past its expiry
 */
export async function readSignupIntent(
  request: Request
): Promise<SignupIntent | null> {
  const raw: unknown = await signupIntentCookie
    .parse(request.headers.get("Cookie"))
    .catch(() => null);

  const stored = StoredSignupIntentSchema.safeParse(raw);
  if (!stored.success) {
    return null;
  }

  const { expiresAt, ...intent } = stored.data;
  if (expiresAt <= Date.now()) {
    return null;
  }

  return intent;
}

/**
 * Serializes an intent into a `Set-Cookie` value with a fresh window.
 *
 * @param intent - The intent to carry
 * @returns The `Set-Cookie` header value
 */
export async function serializeSignupIntent(
  intent: SignupIntent
): Promise<string> {
  return signupIntentCookie.serialize({
    ...intent,
    expiresAt: Date.now() + SIGNUP_INTENT_TTL_SECONDS * 1000,
  });
}

/**
 * Serializes a `Set-Cookie` value that removes the cookie.
 *
 * @returns The `Set-Cookie` header value
 */
export async function serializeClearedSignupIntent(): Promise<string> {
  return signupIntentCookie.serialize("", { maxAge: 0 });
}

/**
 * `Set-Cookie` headers that carry an intent forward with a fresh window, or
 * no headers at all when there is nothing to carry. Spread the result into a
 * redirect's headers so responses without an intent stay byte-for-byte as
 * they were.
 *
 * @param intent - The intent read from the current request, if any
 */
export async function signupIntentHeaders(
  intent: SignupIntent | null
): Promise<Array<[string, string]>> {
  if (!intent) {
    return [];
  }
  return [["Set-Cookie", await serializeSignupIntent(intent)]];
}

/**
 * Reads the request's intent and returns the headers that re-issue it.
 * For steps that only pass the intent along and never look inside it.
 *
 * @param request - The incoming request
 */
export async function refreshSignupIntentHeaders(
  request: Request
): Promise<Array<[string, string]>> {
  return signupIntentHeaders(await readSignupIntent(request));
}

/**
 * The header that removes the cookie once onboarding has consumed it.
 */
export async function clearSignupIntentHeaders(): Promise<
  Array<[string, string]>
> {
  return [["Set-Cookie", await serializeClearedSignupIntent()]];
}
