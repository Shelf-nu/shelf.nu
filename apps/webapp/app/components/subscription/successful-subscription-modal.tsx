import { BellIcon } from "@radix-ui/react-icons";
import { AnimatePresence } from "framer-motion";
import { useBlocker } from "react-router";
import { useSearchParams } from "~/hooks/search-params";

import { Button } from "../shared/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../shared/modal";
import { WarningBox } from "../shared/warning-box";

export default function SuccessfulSubscriptionModal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const success = searchParams.get("success") || false;
  const isTeam = searchParams.get("team") === "true";
  const hasExistingWorkspace =
    searchParams.get("hasExistingWorkspace") === "true";

  return (
    <>
      <AnimatePresence>
        {success ? (
          <div className="dialog-backdrop !bg-[#364054]/70">
            <dialog
              className="dialog m-auto h-auto w-[90%] sm:w-[400px]"
              open={true}
            >
              <div className="relative z-10  rounded bg-surface p-6 shadow-lg">
                <video
                  height="200"
                  autoPlay
                  loop
                  muted
                  className="mb-6 rounded"
                >
                  <source
                    src="/static/videos/celebration.mp4"
                    type="video/mp4"
                  />
                </video>
                <div className="mb-8 text-center">
                  <h4 className="mb-1 text-[18px] font-semibold">
                    You are all set!
                  </h4>
                  <p className="text-color-600">
                    {isTeam ? "Team" : "Plus"} features unlocked.{" "}
                    {isTeam && !hasExistingWorkspace
                      ? "Now, it is time to create your team workspace and start adding assets."
                      : "Now, it is time to start adding assets. Make sure you are in the right workspace."}
                  </p>
                </div>
                {isTeam && !hasExistingWorkspace ? (
                  <>
                    <div className="my-4 text-color-700">
                      <strong>IMPORTANT</strong>: To use the Team features you
                      need to use your Team workspace. Make sure to create it
                      before you continue.
                    </div>
                    <Button
                      width="full"
                      onClick={() => {
                        setSearchParams((prev) => {
                          /** We remove the success param as that controls this modal being visible */
                          prev.delete("success");
                          return prev;
                        });
                      }}
                      variant="accent"
                    >
                      Create Team workspace
                    </Button>
                  </>
                ) : (
                  <Button width="full" to="/assets" variant="accent">
                    Get started
                  </Button>
                )}
              </div>
            </dialog>
          </div>
        ) : null}
      </AnimatePresence>
      <AreYouSureModal shouldBlock={isTeam && !hasExistingWorkspace} />
    </>
  );
}

function AreYouSureModal({ shouldBlock }: { shouldBlock: boolean }) {
  const [searchParams] = useSearchParams();
  const isTrial = searchParams.get("trial") === "true";

  // Block navigating elsewhere when data has been entered into the input
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      shouldBlock && currentLocation.pathname !== nextLocation.pathname
  );
  return blocker && blocker.state === "blocked" ? (
    <AlertDialog open={blocker.state === "blocked"}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <BellIcon />
            </span>
          </div>
          <AlertDialogTitle>Leaving page</AlertDialogTitle>
          <AlertDialogDescription>
            You just got your{" "}
            <span className="font-semibold">
              Team subscription{isTrial ? " trial" : ""}
            </span>
            . <br />
            Do you want to create your Team workspace to get full advantage of
            Shelf?
          </AlertDialogDescription>
          <WarningBox className="my-4 ">
            <>
              {" "}
              <strong>IMPORTANT</strong>: To use the Team features you need to
              use your Team workspace. Make sure to create it before you
              continue.
            </>
          </WarningBox>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <div className="flex w-full flex-col justify-center gap-2">
            <Button
              variant="secondary"
              width="full"
              onClick={() => blocker.reset()}
            >
              Yes, I want to create a Team workspace
            </Button>

            <Button
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
              onClick={() => blocker.proceed()}
            >
              No, I will create it later
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;
}
