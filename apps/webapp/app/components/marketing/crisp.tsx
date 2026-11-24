/**
 * Crisp live chat wiring.
 *
 * Crisp is optional: it runs only when `CRISP_WEBSITE_ID` is set, which is the
 * case on Shelf's hosted app and usually not on a self-hosted install. Every
 * caller opens the chat through {@link openCrispChat}, never `Crisp.chat.open()`
 * directly: the SDK throws when it was never configured with a website id.
 *
 * @see {@link file://./../feedback/feedback-modal.tsx}
 */
import { useEffect } from "react";
import { Crisp } from "crisp-sdk-web";
import { useUserData } from "~/hooks/use-user-data";
import { resolveUserDisplayName } from "~/utils/user";
import type { HTMLButtonProps } from "../shared/button";
import { Button } from "../shared/button";

/**
 * Whether this install has Crisp configured. False on the server, where
 * `window` does not exist.
 *
 * @returns True when `CRISP_WEBSITE_ID` is set in the browser env
 */
export function isCrispEnabled(): boolean {
  return typeof window !== "undefined" && Boolean(window.env?.CRISP_WEBSITE_ID);
}

/**
 * Opens the Crisp chat window, or does nothing when Crisp is not configured.
 *
 * @returns True when the chat was opened
 */
export function openCrispChat(): boolean {
  if (!isCrispEnabled()) return false;
  Crisp.chat.open();
  return true;
}

/** Configures Crisp for the signed-in user, when Crisp is enabled. */
export function useCrisp() {
  const user = useUserData();

  useEffect(() => {
    if (!isCrispEnabled()) return;
    Crisp.configure(window.env.CRISP_WEBSITE_ID, { autoload: false });
    if (!user) return;
    /** Set some user data in crisp */
    Crisp.user.setEmail(user.email);
    Crisp.user.setNickname(
      `${resolveUserDisplayName(user)} (${user.username}) `
    );
  }, [user]);
}

/**
 * Link-style button that opens the Crisp chat. Without Crisp configured the
 * click does nothing, so the surrounding sentence still reads correctly.
 */
export const CrispButton = (props: Omit<HTMLButtonProps, "type">) => (
  <Button {...props} onClick={() => openCrispChat()} type="button">
    {props.children}
  </Button>
);
