import { makeShelfError } from "~/utils/error";
import { action } from "~/routes/api+/feedback";
import { createActionArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
const createDataMock = vitest.hoisted(() => {
  return () =>
    vitest.fn((data: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(data), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vitest.mock("react-router", async () => {
  const actual = await vitest.importActual("react-router");
  return {
    ...actual,
    data: createDataMock(),
  };
});

// why: external file upload — we don't want to hit Supabase in tests
vitest.mock("~/utils/storage.server", () => ({
  parseFileFormData: vitest.fn(),
  getPublicFileURL: vitest.fn(),
}));

// why: external database call
vitest.mock("~/modules/user/service.server", () => ({
  getUserByID: vitest.fn(),
}));

// why: external cookie/session resolution
vitest.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vitest.fn(),
}));

// why: external email sending
vitest.mock("~/emails/feedback/feedback-email", () => ({
  sendFeedbackEmail: vitest.fn(),
}));

vitest.mock("~/utils/error", () => ({
  makeShelfError: vitest.fn(),
}));

import { parseFileFormData, getPublicFileURL } from "~/utils/storage.server";
import { getUserByID } from "~/modules/user/service.server";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { sendFeedbackEmail } from "~/emails/feedback/feedback-email";

const mockContext = {
  getSession: () => ({ userId: "user-1" }),
  appVersion: "test",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as any;

function createFeedbackRequest(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new Request("http://localhost:3000/api/feedback", {
    method: "POST",
    body: formData,
  });
}

describe("/api/feedback", () => {
  beforeEach(() => {
    vitest.clearAllMocks();

    (getUserByID as any).mockResolvedValue({
      firstName: "Jane",
      lastName: "Doe",
      username: "janedoe",
      email: "jane@example.com",
    });

    (getSelectedOrganization as any).mockResolvedValue({
      currentOrganization: { name: "Acme Corp" },
      organizationId: "org-1",
    });

    // parseFileFormData returns a FormData with the validated text fields
    // plus the screenshot path string (replacing the File)
    (parseFileFormData as any).mockImplementation(async () => {
      const fd = new FormData();
      fd.set("type", "issue");
      fd.set("message", "Something is broken in the app");
      fd.set("screenshot", "");
      return fd;
    });

    (sendFeedbackEmail as any).mockResolvedValue(undefined);
    (getPublicFileURL as any).mockReturnValue(
      "https://storage.example.com/file.png"
    );
  });

  describe("action", () => {
    it("should submit feedback successfully", async () => {
      const request = createFeedbackRequest({
        type: "issue",
        message: "Something is broken in the app",
      });

      const result = await action(
        createActionArgs({ request, context: mockContext })
      );

      expect(result instanceof Response).toBe(true);
      const body = await (result as unknown as Response).json();
      expect(body).toEqual({ error: null, success: true });

      expect(sendFeedbackEmail).toHaveBeenCalledWith({
        userName: "Jane Doe",
        userEmail: "jane@example.com",
        organizationName: "Acme Corp",
        type: "issue",
        message: "Something is broken in the app",
        screenshotUrl: null,
      });
    });

    it("should use the selected organization, not an arbitrary one", async () => {
      const request = createFeedbackRequest({
        type: "idea",
        message: "Add dark mode to the dashboard",
      });

      // parseFileFormData returns matching fields
      (parseFileFormData as any).mockImplementation(async () => {
        const fd = new FormData();
        fd.set("type", "idea");
        fd.set("message", "Add dark mode to the dashboard");
        fd.set("screenshot", "");
        return fd;
      });

      await action(createActionArgs({ request, context: mockContext }));

      expect(getSelectedOrganization).toHaveBeenCalledWith({
        userId: "user-1",
        request: expect.any(Request),
      });

      expect(sendFeedbackEmail).toHaveBeenCalledWith(
        expect.objectContaining({ organizationName: "Acme Corp" })
      );
    });

    it("should return validation error for short message", async () => {
      const request = createFeedbackRequest({
        type: "issue",
        message: "short",
      });

      const shelfError = {
        status: 400,
        message: "Please provide at least 10 characters",
      };
      (makeShelfError as any).mockReturnValue(shelfError);

      const result = await action(
        createActionArgs({ request, context: mockContext })
      );

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(400);

      // parseFileFormData should NOT be called when validation fails first
      expect(parseFileFormData).not.toHaveBeenCalled();
    });

    it("should return error for non-POST requests", async () => {
      const request = new Request("http://localhost:3000/api/feedback", {
        method: "GET",
      });

      const shelfError = { status: 405, message: "Method not allowed" };
      (makeShelfError as any).mockReturnValue(shelfError);

      const result = await action(
        createActionArgs({ request, context: mockContext })
      );

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(405);
    });

    it("should include screenshot URL when provided", async () => {
      const request = createFeedbackRequest({
        type: "issue",
        message: "Something is broken in the app",
      });

      (parseFileFormData as any).mockImplementation(async () => {
        const fd = new FormData();
        fd.set("type", "issue");
        fd.set("message", "Something is broken in the app");
        fd.set("screenshot", "feedback/user-1/123456.png");
        return fd;
      });

      await action(createActionArgs({ request, context: mockContext }));

      expect(getPublicFileURL).toHaveBeenCalledWith({
        filename: "feedback/user-1/123456.png",
        bucketName: "files",
      });

      expect(sendFeedbackEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          screenshotUrl: "https://storage.example.com/file.png",
        })
      );
    });
  });
});
