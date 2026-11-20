/**
 * Tests for the Crisp guards: the chat opens only on an install that has
 * `CRISP_WEBSITE_ID` set, and is a silent no-op everywhere else.
 *
 * @see {@link file://./crisp.tsx}
 */
import { Crisp } from "crisp-sdk-web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isCrispEnabled, openCrispChat } from "./crisp";

// why: the real SDK throws unless configured and injects a remote script;
// the tests only need to see whether the chat was asked to open
vi.mock("crisp-sdk-web", () => ({
  Crisp: { chat: { open: vi.fn() } },
}));

/** Sets the browser env for one test, keeping every other key it had. */
function setCrispWebsiteId(id: string) {
  window.env = { ...window.env, CRISP_WEBSITE_ID: id };
}

describe("Crisp guards", () => {
  const originalEnv = window.env;

  beforeEach(() => {
    vi.mocked(Crisp.chat.open).mockClear();
  });

  afterEach(() => {
    window.env = originalEnv;
  });

  it("does not open the chat when no website id is configured", () => {
    setCrispWebsiteId("");

    expect(isCrispEnabled()).toBe(false);
    expect(openCrispChat()).toBe(false);
    expect(Crisp.chat.open).not.toHaveBeenCalled();
  });

  it("opens the chat when a website id is configured", () => {
    setCrispWebsiteId("test-website-id");

    expect(isCrispEnabled()).toBe(true);
    expect(openCrispChat()).toBe(true);
    expect(Crisp.chat.open).toHaveBeenCalledTimes(1);
  });
});
