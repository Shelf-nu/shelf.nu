import { useFetcher, useLoaderData } from "@remix-run/react";
import { XIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import type { loader } from "~/routes/_layout+/_layout";

export const SidebarNoticeCard = () => {
  const { hideNoticeCard } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  let optimisticHideNoticeCard = hideNoticeCard;
  if (fetcher.formData) {
    optimisticHideNoticeCard =
      fetcher.formData.get("noticeCardVisibility") === "hidden";
  }

  return optimisticHideNoticeCard ? null : (
    <div className="support-banner mb-6 hidden rounded border bg-gray-50 px-2 py-3 md:block">
      <div className="flex justify-between align-middle">
        <h5 className="mb-1 font-semibold text-gray-900">
          Install Shelf for Mobile
        </h5>
        <div className="mt-[-6px]">
          <fetcher.Form
            method="post"
            action="/api/user/prefs/dismiss-notice-card"
          >
            <input type="hidden" name="noticeCardVisibility" value="hidden" />
            <button type="submit">
              <XIcon />
            </button>
          </fetcher.Form>
        </div>
      </div>

      <p className="text-gray-600">
        Always available access to shelf, with all features you have on desktop.
      </p>
      <img
        src="/static/images/carlos-support.jpg"
        alt="Carlos support shelf.nu"
        className="my-4 rounded"
      />
      <p>
        <Button
          variant="link"
          to="https://www.shelf.nu/blog/new-shelf-pwa-progresive-web-application-live-learn-how-to-use"
        >
          Written Tutorial
        </Button>
      </p>
    </div>
  );
};
