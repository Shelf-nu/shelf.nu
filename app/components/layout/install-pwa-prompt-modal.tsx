import { useRef } from "react";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { AnimatePresence, motion } from "framer-motion";
import type { LayoutLoaderResponse } from "~/routes/_layout+/_layout";
import { usePwaManager } from "~/utils/pwa-manager";
import { Button } from "../shared/button";

export function InstallPwaPromptModal() {
  const { hideInstallPwaPrompt } = useLoaderData<LayoutLoaderResponse>();
  const fetcher = useFetcher();
  let optimisticHideInstallPwaPrompt = hideInstallPwaPrompt;
  if (fetcher.formData) {
    optimisticHideInstallPwaPrompt =
      fetcher.formData.get("pwaPromptVisibility") === "hidden";
  }
  const hidePwaPromptForm = useRef<HTMLFormElement | null>(null);

  const { promptInstall } = usePwaManager();

  return optimisticHideInstallPwaPrompt ? null : (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <div className="dialog-backdrop !items-end !bg-[#364054]/70">
          <dialog
            className="dialog m-auto h-auto w-[90%] pb-8 sm:w-[400px]"
            open={true}
          >
            <div className="relative z-10  rounded-xl bg-surface p-4 shadow-lg">
              <div className="mb-8 text-center">
                <h4 className="mb-1 text-[18px] font-semibold">
                  Install shelf for mobile
                </h4>
                <p className="text-color-600">
                  Always available access to shelf, with all features you have
                  on desktop.{" "}
                  {promptInstall && (
                    <>
                      Use the <strong>install button below</strong> to add shelf
                      to your device.
                    </>
                  )}
                </p>
                {promptInstall ? null : (
                  <>
                    <ol className="mb-8 mt-2 pt-2">
                      <li>
                        1. Click the <strong>share icon</strong>
                      </li>
                      <li>
                        2. Click <strong>"Add to Home Screen"</strong>
                      </li>
                      <li>3. Enjoy Shelf on your mobile device</li>
                    </ol>

                    <video
                      height="200"
                      loop
                      autoPlay
                      muted
                      playsInline
                      className="mb-6 rounded-lg"
                    >
                      <source
                        src="/static/videos/add-to-home-screen.mp4"
                        type="video/mp4"
                      />
                    </video>
                  </>
                )}
                <p>
                  For more information, read the full{" "}
                  <Button
                    to="https://www.shelf.nu/knowledge-base/shelf-mobile-app"
                    variant="link"
                    target="_blank"
                    className="mt-4"
                  >
                    guide
                  </Button>
                </p>
              </div>

              {promptInstall && (
                <Button
                  width="full"
                  variant="primary"
                  className="mb-3"
                  onClick={async () => {
                    await promptInstall().then(() =>
                      fetcher.submit(hidePwaPromptForm.current, {
                        method: "POST",
                      })
                    );
                  }}
                >
                  Install
                </Button>
              )}
              <fetcher.Form
                ref={hidePwaPromptForm}
                method="post"
                action="/api/hide-pwa-install-prompt"
              >
                <input
                  type="hidden"
                  name="pwaPromptVisibility"
                  value="hidden"
                />
                <Button type="submit" width="full" variant="secondary">
                  Skip for 2 weeks
                </Button>
              </fetcher.Form>
            </div>
          </dialog>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
