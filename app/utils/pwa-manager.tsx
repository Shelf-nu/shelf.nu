/**
 * You will be surprised by the code below.
 *
 * `beforeinstallprompt` is an event really hard to work with 😵‍💫
 *
 * It has to be be **listened only once**, by a unique effect in root.tsx, otherwise it will work badly.
 *
 * https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent
 */

import {
  type ReactElement,
  createContext,
  useContext,
  useSyncExternalStore,
} from "react";

/**
 * This is the most reliable way (I found) to work with the `BeforeInstallPromptEvent` on the browser.
 *
 * We will implement what I call the 'external store pattern'.
 */
export type UserChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};
export type PwaManager = {
  promptInstall: null | (() => Promise<UserChoice>);
};

export interface BeforeInstallPromptEvent extends Event {
  platforms: string[];
  prompt: () => Promise<UserChoice>;
}

const PwaManagerContext = createContext<PwaManager | null>(null);

/**
 * Use `BeforeInstallPromptEvent.prompt` to prompt the user to install the PWA.
 * If the PWA is already installed by the current browser, `available` will always be false and `prompt` will always be null.
 *
 * [21/10/2023]
 *
 * ❌ On Safari and Firefox, `available` will always be false and `prompt` will always be null.
 * These the browser does not support prompt to install, `beforeinstallprompt` event is not fired.
 * https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent#browser_compatibility
 *
 * 🤷‍♂️ Arc Browser, even if it's based on Chromium, doesn't support prompt to install.
 * `prompt` never moves from pending to resolved.
 *
 * @returns the BeforeInstallPromptEvent if available
 */
export const usePwaManager = () => {
  const context = useContext(PwaManagerContext);

  if (context === null) {
    throw new Error(`usePwaManager must be used within a PwaManagerProvider.`);
  }

  return context;
};

let promptInstallStore: PwaManager["promptInstall"] = null;

function subscribeToBeforeInstallPromptEvent(callback: () => void) {
  function saveInstallPrompt(event: Event) {
    event.preventDefault();

    promptInstallStore = (event as BeforeInstallPromptEvent).prompt.bind(event);

    callback();
  }

  window.addEventListener("beforeinstallprompt", saveInstallPrompt);

  return () => {
    window.removeEventListener("beforeinstallprompt", saveInstallPrompt);
  };
}

export const PwaManagerProvider = ({
  children,
}: {
  children: ReactElement;
}) => {
  const promptInstall = useSyncExternalStore(
    subscribeToBeforeInstallPromptEvent,
    () => promptInstallStore,
    () => null
  );

  return (
    <PwaManagerContext.Provider
      value={{
        promptInstall: promptInstall,
      }}
    >
      {children}
    </PwaManagerContext.Provider>
  );
};
