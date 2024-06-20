import { useCallback } from "react";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { AnimatePresence } from "framer-motion";
import type { loader } from "~/routes/_layout+/account-details.subscription";
import { Button } from "../shared/button";

export default function SuccessfulSubscriptionModal() {
  const [params, setParams] = useSearchParams();
  const success = params.get("success") || false;
  const isTeam = params.get("team") || false;
  const handleBackdropClose = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      params.delete("success");
      setParams(params);
    },
    [params, setParams]
  );

  const { activeProduct } = useLoaderData<typeof loader>();

  return (
    <AnimatePresence>
      {success ? (
        <div
          className="dialog-backdrop !bg-[#364054]/70"
          onClick={handleBackdropClose}
        >
          <dialog
            className="dialog m-auto h-auto w-[90%] sm:w-[400px]"
            open={true}
          >
            <div className="relative z-10  rounded bg-white p-6 shadow-lg">
              <video height="200" autoPlay loop muted className="mb-6 rounded">
                <source src="/static/videos/celebration.mp4" type="video/mp4" />
              </video>
              <div className="mb-8 text-center">
                <h4 className="mb-1 text-[18px] font-semibold">
                  You are all set!
                </h4>
                <p className="text-gray-600">
                  {activeProduct?.name} features unlocked.{" "}
                  {isTeam && "Now, create a team workspace."}
                </p>
              </div>
              {isTeam ? (
                <Button
                  width="full"
                  to="/account-details/workspace/new"
                  variant="primary"
                >
                  Create your Team workspace
                </Button>
              ) : (
                <Button width="full" to="/assets" variant="primary">
                  Get started
                </Button>
              )}
            </div>
          </dialog>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
