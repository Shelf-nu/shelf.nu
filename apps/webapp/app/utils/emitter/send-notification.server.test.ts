/**
 * Tests for {@link sendNotification}: the wire shape of a toast payload when
 * the notification bus is not running (delivery through the local emitter).
 *
 * @see {@link file://./send-notification.server.ts}
 */
import { describe, expect, it } from "vitest";
import { emitter } from "./emitter.server";
import { sendNotification } from "./send-notification.server";
import { runWithTabId } from "../tab-id.server";

/** Sends a toast and returns the parsed payload the emitter received */
function sendAndCapture(): Record<string, unknown> {
  const received: string[] = [];
  const listener = (payload: string) => received.push(payload);
  emitter.on("notification", listener);
  try {
    sendNotification({
      title: "T",
      icon: { name: "success", variant: "success" },
      senderId: "u1",
    });
  } finally {
    emitter.off("notification", listener);
  }
  expect(received).toHaveLength(1);
  return JSON.parse(received[0]);
}

describe("sendNotification", () => {
  it("emits locally when the bus never started", () => {
    const payload = sendAndCapture();

    expect(payload).toMatchObject({ title: "T", open: true, senderId: "u1" });
    expect(typeof payload.time).toBe("number");
  });

  it("tags the payload with the current tab", () => {
    const payload = runWithTabId("tab-1", sendAndCapture);

    expect(payload.tabId).toBe("tab-1");
  });
});
