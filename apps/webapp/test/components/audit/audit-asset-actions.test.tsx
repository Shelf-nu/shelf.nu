/**
 * The scan list's "Add image" button: a file input that opens the camera.
 *
 * Pins the client half of the capture-stamp contract. The route test
 * (`test/routes-tests/api+/audits.upload-image.test.ts`) pins the server half:
 * this input sends `capturedAt` as the picked file's `lastModified`, and the
 * input itself keeps the attributes that make phones open the camera.
 */
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditAssetActions } from "~/components/audit/audit-asset-actions";

// why: the component submits through a fetcher; capture what it would send
const submit = vi.hoisted(() => vi.fn());
vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useFetcher: () => ({ submit, state: "idle", data: undefined }),
    useNavigation: () => ({ state: "idle" }),
    // why: the comment button renders a link; no router is mounted here
    Link: ({ children, to, ...props }: { children: unknown; to: string }) => (
      <a href={to} {...props}>
        {children as never}
      </a>
    ),
  };
});

function renderActions() {
  const { container } = render(
    <AuditAssetActions
      auditAssetId="audit-asset-1"
      auditSessionId="audit-1"
      assetName="Libec LX-7 Tripod"
    />
  );
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not rendered");
  return input;
}

function pick(input: HTMLInputElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
  const [formData] = submit.mock.calls[0] as [FormData];
  return formData;
}

describe("AuditAssetActions take-photo input", () => {
  beforeEach(() => {
    submit.mockClear();
  });

  it("keeps the attributes that open the phone camera directly", () => {
    const input = renderActions();
    expect(input.getAttribute("capture")).toBe("environment");
    expect(input.getAttribute("accept")).toBe("image/*");
  });

  it("sends the photo's capture time as capturedAt", () => {
    const taken = Date.parse("2026-10-01T21:01:30.000Z");
    const formData = pick(
      renderActions(),
      new File(["x"], "photo.jpg", { type: "image/jpeg", lastModified: taken })
    );

    expect(formData.get("capturedAt")).toBe("2026-10-01T21:01:30.000Z");
    expect(formData.get("auditAssetId")).toBe("audit-asset-1");
    expect(formData.get("image")).toBeInstanceOf(File);
    expect(submit).toHaveBeenCalledWith(
      formData,
      expect.objectContaining({ action: "/api/audits/audit-1/upload-image" })
    );
  });

  it("sends no capturedAt when the browser gives the file no time", () => {
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    // why: Happy DOM turns a zero `lastModified` into "now"; browsers keep 0
    Object.defineProperty(file, "lastModified", { value: 0 });

    const formData = pick(renderActions(), file);
    expect(formData.has("capturedAt")).toBe(false);
  });
});
