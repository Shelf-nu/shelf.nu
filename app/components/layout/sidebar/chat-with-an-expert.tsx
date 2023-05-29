import { useFetcher, useLoaderData } from "@remix-run/react";
import { XIcon } from "~/components/icons";
import { CrispButton } from "~/components/marketing/crisp";

export const ChatWithAnExpert = () => {
  const { hideSupportBanner } = useLoaderData();

  const fetcher = useFetcher();
  return hideSupportBanner ? null : (
    <div className="mb-6 hidden rounded-lg bg-gray-50 px-4 py-5 md:block">
      <div className="flex justify-between align-middle">
        <h5 className="mb-1 font-semibold text-gray-900">
          Got feedback or need help?
        </h5>
        <div className="mt-[-6px]">
          <fetcher.Form method="post" action="/api/user/dismiss-support-banner">
            <input type="hidden" name="bannerVisibility" value="hidden" />
            <button type="submit">
              <XIcon />
            </button>
          </fetcher.Form>
        </div>
      </div>

      <p className="text-gray-600">
        We can help you almost instantly with anything related to the Shelf App.
        Just open up a chat with us.
      </p>
      <img
        src="/images/carlos-support.jpg"
        alt="Carlos support shelf.nu"
        className="my-4 rounded-lg"
      />
      <p>
        <CrispButton variant="link">Chat with an expert</CrispButton>
      </p>
    </div>
  );
};
