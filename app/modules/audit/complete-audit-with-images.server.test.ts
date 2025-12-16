import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeAuditWithImages } from "./complete-audit-with-images.server";

// Mock the dependencies
vi.mock("./image.service.server", () => ({
  // why: Mock image upload to avoid actual file operations during tests
  uploadAuditImage: vi.fn(),
}));

vi.mock("./service.server", () => ({
  // why: Mock audit completion to focus on testing the image upload logic
  completeAuditSession: vi.fn(),
}));

import { uploadAuditImage } from "./image.service.server";
import { completeAuditSession } from "./service.server";

describe("completeAuditWithImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes audit without images", async () => {
    const formData = new FormData();
    formData.append("note", "Test completion note");

    const mockRequest = {
      url: "http://localhost:3000/audits/test-audit/complete",
      formData: () => Promise.resolve(formData),
    } as any;

    vi.mocked(completeAuditSession).mockResolvedValue(undefined);

    await completeAuditWithImages({
      request: mockRequest,
      auditSessionId: "audit-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(uploadAuditImage).not.toHaveBeenCalled();
    expect(completeAuditSession).toHaveBeenCalledWith({
      sessionId: "audit-1",
      organizationId: "org-1",
      userId: "user-1",
      completionNote: "Test completion note",
    });
  });

  it("uploads single image before completing audit", async () => {
    const formData = new FormData();
    formData.append("note", "Completion with image");
    const mockFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
    formData.append("auditImage", mockFile);

    const mockRequest = {
      url: "http://localhost:3000/audits/test-audit/complete",
      formData: () => Promise.resolve(formData),
    } as any;

    vi.mocked(uploadAuditImage).mockResolvedValue({
      id: "img-1",
      imageUrl: "org-1/audits/audit-1/img-1.jpg",
      thumbnailUrl: "org-1/audits/audit-1/img-1-thumbnail.jpg",
    } as any);

    vi.mocked(completeAuditSession).mockResolvedValue(undefined);

    await completeAuditWithImages({
      request: mockRequest,
      auditSessionId: "audit-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(uploadAuditImage).toHaveBeenCalledTimes(1);
    expect(uploadAuditImage).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.any(Request),
        auditSessionId: "audit-1",
        organizationId: "org-1",
        uploadedById: "user-1",
        auditAssetId: undefined,
        description: "Completion image",
      })
    );

    expect(completeAuditSession).toHaveBeenCalledWith({
      sessionId: "audit-1",
      organizationId: "org-1",
      userId: "user-1",
      completionNote: "Completion with image",
    });
  });

  it("uploads multiple images before completing audit", async () => {
    const formData = new FormData();
    formData.append("note", "Multiple images");
    const mockFile1 = new File(["test1"], "test1.jpg", { type: "image/jpeg" });
    const mockFile2 = new File(["test2"], "test2.jpg", { type: "image/jpeg" });
    const mockFile3 = new File(["test3"], "test3.jpg", { type: "image/jpeg" });
    formData.append("auditImage", mockFile1);
    formData.append("auditImage", mockFile2);
    formData.append("auditImage", mockFile3);

    const mockRequest = {
      url: "http://localhost:3000/audits/test-audit/complete",
      formData: () => Promise.resolve(formData),
    } as any;

    vi.mocked(uploadAuditImage).mockResolvedValue({
      id: "img-1",
      imageUrl: "org-1/audits/audit-1/img-1.jpg",
      thumbnailUrl: "org-1/audits/audit-1/img-1-thumbnail.jpg",
    } as any);

    vi.mocked(completeAuditSession).mockResolvedValue(undefined);

    await completeAuditWithImages({
      request: mockRequest,
      auditSessionId: "audit-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(uploadAuditImage).toHaveBeenCalledTimes(3);
    expect(completeAuditSession).toHaveBeenCalledWith({
      sessionId: "audit-1",
      organizationId: "org-1",
      userId: "user-1",
      completionNote: "Multiple images",
    });
  });

  it("ignores empty file inputs", async () => {
    const formData = new FormData();
    formData.append("note", "Empty files ignored");
    // Add an empty file (size 0)
    const emptyFile = new File([], "empty.jpg", { type: "image/jpeg" });
    formData.append("auditImage", emptyFile);

    const mockRequest = {
      url: "http://localhost:3000/audits/test-audit/complete",
      formData: () => Promise.resolve(formData),
    } as any;

    vi.mocked(completeAuditSession).mockResolvedValue(undefined);

    await completeAuditWithImages({
      request: mockRequest,
      auditSessionId: "audit-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    // Empty files should be ignored
    expect(uploadAuditImage).not.toHaveBeenCalled();
    expect(completeAuditSession).toHaveBeenCalled();
  });

  it("completes audit without note when note is not provided", async () => {
    const formData = new FormData();
    // No note field

    const mockRequest = {
      url: "http://localhost:3000/audits/test-audit/complete",
      formData: () => Promise.resolve(formData),
    } as any;

    vi.mocked(completeAuditSession).mockResolvedValue(undefined);

    await completeAuditWithImages({
      request: mockRequest,
      auditSessionId: "audit-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(completeAuditSession).toHaveBeenCalledWith({
      sessionId: "audit-1",
      organizationId: "org-1",
      userId: "user-1",
      completionNote: undefined,
    });
  });

  it("waits for all image uploads to complete before completing audit", async () => {
    const formData = new FormData();
    formData.append("note", "Test ordering");
    const mockFile1 = new File(["test1"], "test1.jpg", { type: "image/jpeg" });
    const mockFile2 = new File(["test2"], "test2.jpg", { type: "image/jpeg" });
    formData.append("auditImage", mockFile1);
    formData.append("auditImage", mockFile2);

    const mockRequest = {
      url: "http://localhost:3000/audits/test-audit/complete",
      formData: () => Promise.resolve(formData),
    } as any;

    let uploadCount = 0;
    vi.mocked(uploadAuditImage).mockImplementation(() => {
      uploadCount++;
      // Simulate async operation
      return Promise.resolve({
        id: `img-${uploadCount}`,
        imageUrl: `org-1/audits/audit-1/img-${uploadCount}.jpg`,
        thumbnailUrl: `org-1/audits/audit-1/img-${uploadCount}-thumbnail.jpg`,
      } as any);
    });

    vi.mocked(completeAuditSession).mockImplementation(() => {
      // Verify that all uploads completed before this runs
      expect(uploadCount).toBe(2);
      return Promise.resolve(undefined);
    });

    await completeAuditWithImages({
      request: mockRequest,
      auditSessionId: "audit-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(uploadAuditImage).toHaveBeenCalledTimes(2);
    expect(completeAuditSession).toHaveBeenCalledTimes(1);
  });
});
