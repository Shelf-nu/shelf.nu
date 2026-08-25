/**
 * Remembers whether the Settings > Team upgrade banner is folded.
 *
 * The banner explains why a Personal workspace cannot invite people. Someone
 * who came to that page to manage non-registered members has already read it,
 * so it folds to a single line — and folds back open, which is why this takes
 * a state rather than only recording a dismissal. Collapsing it must not be
 * the last time the explanation is reachable.
 *
 * Stored on the `user-prefs` cookie, like the sidebar notice card, so it is per
 * browser and lapses with that cookie's week-long lifetime. The alternative — a
 * `User` column — is a migration for a fold state.
 *
 * @see {@link file://./../../components/settings/team-upgrade-banner.tsx}
 * @see {@link file://./user.prefs.dismiss-notice-card.ts}
 */
import { type ActionFunctionArgs, data } from "react-router";
import { setCookie, userPrefs } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const cookieHeader = request.headers.get("Cookie");
    const cookie = (await userPrefs.parse(cookieHeader)) || {};
    const bodyParams = await request.formData();

    // Written both ways: expanding has to survive a reload too, or the fold
    // would be one-directional in everything but the animation.
    cookie.teamUpgradeBannerCollapsed = bodyParams.get("collapsed") === "true";

    return data(payload({ success: true }), {
      headers: [setCookie(await userPrefs.serialize(cookie))],
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
