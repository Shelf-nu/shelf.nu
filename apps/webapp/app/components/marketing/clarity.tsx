/**
 * Microsoft Clarity session recording, limited to public signed-out pages.
 *
 * Clarity records the page URL and what is on screen, so it runs only on the
 * pages listed in {@link CLARITY_PAGES}; pages inside the app are never
 * recorded. The app navigates client-side, so a recording that starts on
 * `/login` would carry on into the app after sign-in unless it is stopped:
 * the component stops Clarity whenever the current page is not on the list and
 * starts it again when the user comes back to one.
 *
 * @see {@link file://./../../root.tsx} — rendered once, in the document head
 * @see {@link file://./../../../server/index.ts} — `publicPaths`, the routes
 *   reachable without a session
 */
import { useEffect } from "react";
import { clarity } from "react-microsoft-clarity";
import { matchPath, useLocation } from "react-router";

/**
 * The pages Clarity may record: public (in the server's `publicPaths`), render
 * a page, and carry no credential in their URL.
 *
 * Public pages deliberately left out:
 * - `/accept-invite/:inviteId` — the URL carries the signed invite (`?token=`)
 * - `/oauth/callback` and `/oauth/callback/mobile` — the URL fragment carries
 *   the Supabase access and refresh tokens
 * - `/`, `/qr/:qrId`, `/logout`, `/send-otp`, `/resend-otp` — redirects and
 *   form actions only; nothing to record
 */
export const CLARITY_PAGES = [
  "/login",
  "/join",
  "/otp",
  "/forgot-password",
  "/sso-login",
  "/qr/:qrId/not-logged-in",
  "/qr/:qrId/contact-owner",
] as const;

/**
 * Whether Clarity may record the page at `pathname`.
 *
 * @param pathname - The current location's pathname (no query string)
 * @returns `true` only for the pages in {@link CLARITY_PAGES}
 */
export function isClarityPage(pathname: string): boolean {
  return CLARITY_PAGES.some((pattern) => matchPath(pattern, pathname) !== null);
}

/**
 * Loads Clarity on the first recordable page and stops or restarts it as the
 * user moves between recordable pages and the rest of the app. Renders nothing,
 * and does nothing when `MICROSOFT_CLARITY_ID` is not set.
 */
export const Clarity = () => {
  const { pathname } = useLocation();
  const shouldRecord = isClarityPage(pathname);

  useEffect(() => {
    const clarityId = window.env?.MICROSOFT_CLARITY_ID;
    if (!clarityId) {
      return;
    }

    if (shouldRecord) {
      if (clarity.hasStarted()) {
        clarity.start();
      } else {
        clarity.init(clarityId);
      }
    } else if (clarity.hasStarted()) {
      clarity.stop();
    }
  }, [shouldRecord]);

  return null;
};
