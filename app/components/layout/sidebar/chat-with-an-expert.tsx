import { useFetcher, useLoaderData } from "@remix-run/react";
import { XIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import type { loader } from "~/routes/_layout+/_layout";

export const ChatWithAnExpert = () => {
  const { hideSupportBanner } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  let optimisticHideSupportBanner = hideSupportBanner;
  if (fetcher.formData) {
    optimisticHideSupportBanner =
      fetcher.formData.get("bannerVisibility") === "hidden";
  }

  return optimisticHideSupportBanner ? null : (
    <div className="support-banner mb-6 hidden rounded bg-gray-50 px-4 py-5 md:mt-10 md:block">
      <div className="flex justify-between align-middle">
        <h5 className="mb-1 font-semibold text-gray-900">
          New: Order Asset Labels
        </h5>
        <div className="mt-[-6px]">
          <fetcher.Form
            method="post"
            action="/api/user/prefs/dismiss-support-banner"
          >
            <input type="hidden" name="bannerVisibility" value="hidden" />
            <button type="submit">
              <XIcon />
            </button>
          </fetcher.Form>
        </div>
      </div>

      <p className="text-gray-600">
        We are happy to announce that we have the infrastructure to produce
        custom branded labels for your business. Affordable rates, fast
        turnaround, global shipping, various materials.
      </p>
      <img
        src="/static/images/carlos-support.jpg"
        alt="Carlos support shelf.nu"
        className="my-4 rounded"
      />
      <p>
        <Button
          variant="link"
          to="https://www.shelf.nu/blog/introducing-shelfs-sticker-studio"
        >
          View offer
        </Button>
      </p>
    </div>
  );
};
