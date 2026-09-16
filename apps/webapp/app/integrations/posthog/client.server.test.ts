// @vitest-environment node

/**
 * PostHog server wrapper: what reaches `posthog.capture` for an event, with
 * and without set-once person properties.
 *
 * @see {@link file://./client.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the wrapper reads the key once, on first use; a getter lets the test
// decide whether PostHog is configured before the module is imported.
const envMock = vi.hoisted(() => ({ POSTHOG_API_KEY: "test-key" as string }));
vi.mock("~/utils/env", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("~/utils/env");
  return {
    ...actual,
    get POSTHOG_API_KEY() {
      return envMock.POSTHOG_API_KEY;
    },
    POSTHOG_HOST: "https://posthog.example",
  };
});

// why: no network — record what the wrapper hands to the PostHog client.
const captureMock = vi.hoisted(() => vi.fn());
vi.mock("posthog-node", () => ({
  PostHog: class {
    capture = captureMock;
  },
}));

const { captureServerEvent } = await import("./client.server");

describe("captureServerEvent", () => {
  beforeEach(() => {
    captureMock.mockClear();
  });

  it("sends the event properties as given when nothing is set once", () => {
    captureServerEvent({
      distinctId: "user-1",
      event: "signup_completed",
      properties: { created_with_invite: false, is_sso: false },
    });

    expect(captureMock).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "signup_completed",
      properties: { created_with_invite: false, is_sso: false },
      groups: undefined,
    });
  });

  it("carries set-once person properties as PostHog's $set_once", () => {
    captureServerEvent({
      distinctId: "user-1",
      event: "signup_completed",
      properties: {
        created_with_invite: false,
        is_sso: false,
        signup_plan: "team",
      },
      setOnce: { initial_signup_plan: "team" },
    });

    expect(captureMock).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "signup_completed",
      properties: {
        created_with_invite: false,
        is_sso: false,
        signup_plan: "team",
        $set_once: { initial_signup_plan: "team" },
      },
      groups: undefined,
    });
  });
});
