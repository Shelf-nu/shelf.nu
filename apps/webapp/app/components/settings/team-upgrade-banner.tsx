/**
 * Personal-workspace upgrade banner for Settings > Team.
 *
 * States the one thing a Personal workspace cannot do — invite registered
 * users — on the page where people go looking for it, and offers the action
 * that fixes it.
 *
 * It folds rather than closes. It sits above the non-registered members list,
 * so someone managing that list should be able to put it away; but it is also
 * the only place the limit is explained, so putting it away must not be the
 * last time they can read it. Folded, it keeps the headline and drops the
 * explanation and the CTA — a fold that still pitched would not be a fold.
 *
 * The state is remembered per browser and lapses with the `user-prefs` cookie.
 *
 * @see {@link file://./../../routes/_layout+/settings.team.tsx}
 * @see {@link file://./../../routes/api+/user.prefs.team-upgrade-banner.ts}
 */
import { ChevronDownIcon, UsersIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { Button } from "~/components/shared/button";
import { tw } from "~/utils/tw";

const DETAILS_ID = "team-upgrade-banner-details";

/**
 * Fetcher key for the fold. Listed in `use-nprogress`'s `excludeFetchers`, so
 * changing it here means changing it there.
 */
export const TEAM_UPGRADE_BANNER_FETCHER_KEY = "team-upgrade-banner";

type TeamUpgradeBannerProps = {
  /** Where the CTA points — resolved from the user's entitlement. */
  ctaTo: string;
  /** CTA wording — "Create a Team workspace", "Upgrade to Team", … */
  ctaLabel: string;
  /** Stored fold state, read from `user-prefs`. */
  collapsed: boolean;
};

/**
 * Renders the banner, folded or open.
 *
 * @param props - CTA destination and label, plus the stored fold state
 * @returns The banner
 */
export function TeamUpgradeBanner({
  ctaTo,
  ctaLabel,
  collapsed,
}: TeamUpgradeBannerProps) {
  // Keyed so `use-nprogress` can exclude it: the fold is instant on click, and
  // the global loading bar would tell the user to wait for something that has
  // already happened.
  const fetcher = useFetcher({ key: TEAM_UPGRADE_BANNER_FETCHER_KEY });

  // Follow the in-flight submission rather than the server's answer: waiting a
  // round trip to fold reads as a dead control.
  const pending = fetcher.formData?.get("collapsed");
  const isCollapsed = pending === undefined ? collapsed : pending === "true";

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50">
      <div className="flex items-center gap-3 p-3 md:px-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600">
          <UsersIcon className="size-4" />
        </div>

        <h3 className="min-w-0 flex-1 text-sm font-semibold text-gray-900">
          Inviting people needs a Team workspace
        </h3>

        <fetcher.Form
          method="post"
          action="/api/user/prefs/team-upgrade-banner"
        >
          <input
            type="hidden"
            name="collapsed"
            value={isCollapsed ? "false" : "true"}
          />
          <button
            type="submit"
            aria-expanded={!isCollapsed}
            aria-controls={DETAILS_ID}
            aria-label={
              isCollapsed
                ? "Show why inviting people needs a Team workspace"
                : "Hide why inviting people needs a Team workspace"
            }
            className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          >
            <ChevronDownIcon
              className={tw(
                "size-4 transition-transform",
                isCollapsed ? "" : "rotate-180"
              )}
            />
          </button>
        </fetcher.Form>
      </div>

      {/*
        Always rendered so `aria-controls` points at something real.

        The display utility is what folds it, applied conditionally rather than
        left on alongside the `hidden` attribute: `[hidden]` is a user-agent
        rule and `flex` is an author rule, so the class wins and the panel
        stays open. The attribute is kept for assistive technology.
      */}
      <div
        id={DETAILS_ID}
        hidden={isCollapsed}
        className={tw(
          "gap-3 border-t border-gray-200 p-3 md:gap-4 md:px-4",
          isCollapsed ? "hidden" : "flex flex-col md:flex-row md:items-center"
        )}
      >
        <p className="min-w-0 flex-1 text-sm text-gray-600">
          Personal workspaces are for one person. Team workspaces add teammates,
          shared custody, and bookings.
        </p>
        <Button
          to={ctaTo}
          variant="primary"
          size="sm"
          className="shrink-0 self-start md:self-auto"
        >
          {ctaLabel}
        </Button>
      </div>
    </div>
  );
}
