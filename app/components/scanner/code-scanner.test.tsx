import React, { forwardRef, useEffect, useImperativeHandle } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CodeScanner } from "./code-scanner";

vi.mock("./success-animation", () => ({
  __esModule: true,
  default: () => <div data-testid="success-animation" />,
}));

// Mock react-webcam to expose the forwarded ref and rendered className
vi.mock("react-webcam", () => {
  const MockWebcam = forwardRef<any, any>((props, ref) => {
    const {
      audio: _audio,
      videoConstraints: _videoConstraints,
      onUserMedia,
      onUserMediaError: _onUserMediaError,
      ...rest
    } = props;

    useImperativeHandle(ref, () => ({
      video: {
        videoWidth: 1280,
        videoHeight: 720,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    }));

    useEffect(() => {
      onUserMedia?.();
    }, [onUserMedia]);

    return <div data-testid="mock-webcam" {...rest} />;
  });

  MockWebcam.displayName = "MockWebcam";

  return { __esModule: true, default: MockWebcam };
});

describe("CodeScanner camera mode", () => {
  it("leaves pointer events enabled on the webcam surface", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      render(
        <CodeScanner
          forceMode="camera"
          onCodeDetectionSuccess={vi.fn()}
          paused={false}
          setPaused={vi.fn()}
        />
      );

      const webcam = screen.getByTestId("mock-webcam");
      expect(webcam).not.toHaveClass("pointer-events-none");
    } finally {
      consoleError.mockRestore();
    }
  });
});
