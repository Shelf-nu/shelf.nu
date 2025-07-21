import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import {
  getBookingSettingsForOrganization,
  updateBookingSettings,
} from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// Mock db
vitest.mock("~/database/db.server", () => ({
  db: {
    bookingSettings: {
      upsert: vitest.fn(),
      update: vitest.fn(),
    },
  },
}));

const mockBookingSettingsData = {
  id: "booking-settings-1",
  bufferStartTime: 24,
  tagsRequired: true,
  maxBookingLength: 168,
  organizationId: "org-1",
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-01T00:00:00.000Z"),
};

const mockOrganizationId = "org-1";

describe("getBookingSettingsForOrganization", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should get existing booking settings successfully", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.bookingSettings.upsert.mockResolvedValue(mockBookingSettingsData);

    const result = await getBookingSettingsForOrganization(mockOrganizationId);

    expect(db.bookingSettings.upsert).toHaveBeenCalledWith({
      where: {
        organizationId: mockOrganizationId,
      },
      update: {},
      create: {
        bufferStartTime: 0,
        tagsRequired: false,
        maxBookingLength: null,
        maxBookingLengthSkipClosedDays: false,
        organizationId: mockOrganizationId,
      },
      select: {
        id: true,
        bufferStartTime: true,
        tagsRequired: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
      },
    });
    expect(result).toEqual(mockBookingSettingsData);
  });

  it("should create new booking settings with default values when none exist", async () => {
    expect.assertions(2);
    const defaultSettings = {
      id: "booking-settings-new",
      bufferStartTime: 0,
      tagsRequired: false,
      maxBookingLength: null,
      organizationId: mockOrganizationId,
    };
    //@ts-expect-error missing vitest type
    db.bookingSettings.upsert.mockResolvedValue(defaultSettings);

    const result = await getBookingSettingsForOrganization(mockOrganizationId);

    expect(db.bookingSettings.upsert).toHaveBeenCalledWith({
      where: {
        organizationId: mockOrganizationId,
      },
      update: {},
      create: {
        bufferStartTime: 0,
        tagsRequired: false,
        maxBookingLength: null,
        maxBookingLengthSkipClosedDays: false,
        organizationId: mockOrganizationId,
      },
      select: {
        id: true,
        bufferStartTime: true,
        tagsRequired: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
      },
    });
    expect(result).toEqual(defaultSettings);
  });

  it("should throw ShelfError when database operation fails", async () => {
    expect.assertions(2);
    const dbError = new Error("Database connection failed");
    //@ts-expect-error missing vitest type
    db.bookingSettings.upsert.mockRejectedValue(dbError);

    await expect(
      getBookingSettingsForOrganization(mockOrganizationId)
    ).rejects.toThrow(ShelfError);

    await expect(
      getBookingSettingsForOrganization(mockOrganizationId)
    ).rejects.toMatchObject({
      message: "Failed to retrieve booking settings configuration",
      additionalData: { organizationId: mockOrganizationId },
    });
  });

  it("should handle missing organization id", async () => {
    expect.assertions(1);

    await expect(getBookingSettingsForOrganization("")).rejects.toThrow(
      ShelfError
    );
  });
});

describe("updateBookingSettings", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should update bufferStartTime only", async () => {
    expect.assertions(2);
    const updatedSettings = {
      ...mockBookingSettingsData,
      bufferStartTime: 48,
    };
    //@ts-expect-error missing vitest type
    db.bookingSettings.update.mockResolvedValue(updatedSettings);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      bufferStartTime: 48,
    });

    expect(db.bookingSettings.update).toHaveBeenCalledWith({
      where: { organizationId: mockOrganizationId },
      data: { bufferStartTime: 48 },
      select: {
        id: true,
        bufferStartTime: true,
        tagsRequired: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
      },
    });
    expect(result).toEqual(updatedSettings);
  });

  it("should update tagsRequired only", async () => {
    expect.assertions(2);
    const updatedSettings = {
      ...mockBookingSettingsData,
      tagsRequired: false,
    };
    //@ts-expect-error missing vitest type
    db.bookingSettings.update.mockResolvedValue(updatedSettings);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      tagsRequired: false,
    });

    expect(db.bookingSettings.update).toHaveBeenCalledWith({
      where: { organizationId: mockOrganizationId },
      data: { tagsRequired: false },
      select: {
        id: true,
        bufferStartTime: true,
        tagsRequired: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
      },
    });
    expect(result).toEqual(updatedSettings);
  });

  it("should update maxBookingLength only", async () => {
    expect.assertions(2);
    const updatedSettings = {
      ...mockBookingSettingsData,
      maxBookingLength: 72,
    };
    //@ts-expect-error missing vitest type
    db.bookingSettings.update.mockResolvedValue(updatedSettings);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      maxBookingLength: 72,
    });

    expect(db.bookingSettings.update).toHaveBeenCalledWith({
      where: { organizationId: mockOrganizationId },
      data: { maxBookingLength: 72 },
      select: {
        id: true,
        bufferStartTime: true,
        tagsRequired: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
      },
    });
    expect(result).toEqual(updatedSettings);
  });

  it("should set maxBookingLength to null when passed null", async () => {
    expect.assertions(2);
    const updatedSettings = {
      ...mockBookingSettingsData,
      maxBookingLength: null,
    };
    //@ts-expect-error missing vitest type
    db.bookingSettings.update.mockResolvedValue(updatedSettings);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      maxBookingLength: null,
    });

    expect(db.bookingSettings.update).toHaveBeenCalledWith({
      where: { organizationId: mockOrganizationId },
      data: { maxBookingLength: null },
      select: {
        id: true,
        bufferStartTime: true,
        tagsRequired: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
      },
    });
    expect(result).toEqual(updatedSettings);
  });

  it("should update multiple fields at once", async () => {
    expect.assertions(2);
    const updatedSettings = {
      ...mockBookingSettingsData,
      bufferStartTime: 12,
      tagsRequired: false,
      maxBookingLength: 240,
    };
    //@ts-expect-error missing vitest type
    db.bookingSettings.update.mockResolvedValue(updatedSettings);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      bufferStartTime: 12,
      tagsRequired: false,
      maxBookingLength: 240,
    });

    expect(db.bookingSettings.update).toHaveBeenCalledWith({
      where: { organizationId: mockOrganizationId },
      data: {
        bufferStartTime: 12,
        tagsRequired: false,
        maxBookingLength: 240,
      },
      select: {
        id: true,
        bufferStartTime: true,
        tagsRequired: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
      },
    });
    expect(result).toEqual(updatedSettings);
  });

  it("should only update provided fields and ignore undefined values", async () => {
    expect.assertions(2);
    const updatedSettings = {
      ...mockBookingSettingsData,
      bufferStartTime: 36,
    };
    //@ts-expect-error missing vitest type
    db.bookingSettings.update.mockResolvedValue(updatedSettings);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      bufferStartTime: 36,
      tagsRequired: undefined,
      maxBookingLength: undefined,
    });

    expect(db.bookingSettings.update).toHaveBeenCalledWith({
      where: { organizationId: mockOrganizationId },
      data: { bufferStartTime: 36 },
      select: {
        id: true,
        bufferStartTime: true,
        tagsRequired: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
      },
    });
    expect(result).toEqual(updatedSettings);
  });

  it("should handle zero values correctly", async () => {
    expect.assertions(2);
    const updatedSettings = {
      ...mockBookingSettingsData,
      bufferStartTime: 0,
      maxBookingLength: 0,
    };
    //@ts-expect-error missing vitest type
    db.bookingSettings.update.mockResolvedValue(updatedSettings);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      bufferStartTime: 0,
      maxBookingLength: 0,
    });

    expect(db.bookingSettings.update).toHaveBeenCalledWith({
      where: { organizationId: mockOrganizationId },
      data: {
        bufferStartTime: 0,
        maxBookingLength: 0,
      },
      select: {
        id: true,
        bufferStartTime: true,
        tagsRequired: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
      },
    });
    expect(result).toEqual(updatedSettings);
  });

  it("should handle false values correctly", async () => {
    expect.assertions(2);
    const updatedSettings = {
      ...mockBookingSettingsData,
      tagsRequired: false,
    };
    //@ts-expect-error missing vitest type
    db.bookingSettings.update.mockResolvedValue(updatedSettings);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      tagsRequired: false,
    });

    expect(db.bookingSettings.update).toHaveBeenCalledWith({
      where: { organizationId: mockOrganizationId },
      data: { tagsRequired: false },
      select: {
        id: true,
        bufferStartTime: true,
        tagsRequired: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
      },
    });
    expect(result).toEqual(updatedSettings);
  });

  it("should throw ShelfError when database operation fails", async () => {
    expect.assertions(2);
    const dbError = new Error("Database connection failed");
    //@ts-expect-error missing vitest type
    db.bookingSettings.update.mockRejectedValue(dbError);

    await expect(
      updateBookingSettings({
        organizationId: mockOrganizationId,
        bufferStartTime: 24,
      })
    ).rejects.toThrow(ShelfError);

    await expect(
      updateBookingSettings({
        organizationId: mockOrganizationId,
        bufferStartTime: 24,
      })
    ).rejects.toMatchObject({
      message: "Failed to update booking settings configuration",
      additionalData: {
        organizationId: mockOrganizationId,
        bufferStartTime: 24,
        tagsRequired: undefined,
        maxBookingLength: undefined,
      },
    });
  });

  it("should handle organization not found error", async () => {
    expect.assertions(2);
    const notFoundError = new Error("Record not found");
    //@ts-expect-error adding Prisma error properties
    notFoundError.code = "P2025";
    //@ts-expect-error missing vitest type
    db.bookingSettings.update.mockRejectedValue(notFoundError);

    await expect(
      updateBookingSettings({
        organizationId: "non-existent-org",
        bufferStartTime: 24,
      })
    ).rejects.toThrow(ShelfError);

    await expect(
      updateBookingSettings({
        organizationId: "non-existent-org",
        bufferStartTime: 24,
      })
    ).rejects.toMatchObject({
      message: "Failed to update booking settings configuration",
      additionalData: {
        organizationId: "non-existent-org",
        bufferStartTime: 24,
        tagsRequired: undefined,
        maxBookingLength: undefined,
      },
    });
  });

  it("should handle missing organization id", async () => {
    expect.assertions(1);

    await expect(
      updateBookingSettings({
        organizationId: "",
        bufferStartTime: 24,
      })
    ).rejects.toThrow(ShelfError);
  });

  it("should not call update when no fields are provided", async () => {
    expect.assertions(2);
    const updatedSettings = { ...mockBookingSettingsData };
    //@ts-expect-error missing vitest type
    db.bookingSettings.update.mockResolvedValue(updatedSettings);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
    });

    expect(db.bookingSettings.update).toHaveBeenCalledWith({
      where: { organizationId: mockOrganizationId },
      data: {},
      select: {
        id: true,
        bufferStartTime: true,
        tagsRequired: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
      },
    });
    expect(result).toEqual(updatedSettings);
  });

  it("should include all parameters in error additional data", async () => {
    expect.assertions(1);
    const dbError = new Error("Database connection failed");
    //@ts-expect-error missing vitest type
    db.bookingSettings.update.mockRejectedValue(dbError);

    await expect(
      updateBookingSettings({
        organizationId: mockOrganizationId,
        bufferStartTime: 48,
        tagsRequired: true,
        maxBookingLength: 168,
      })
    ).rejects.toMatchObject({
      message: "Failed to update booking settings configuration",
      additionalData: {
        organizationId: mockOrganizationId,
        bufferStartTime: 48,
        tagsRequired: true,
        maxBookingLength: 168,
      },
    });
  });
});
