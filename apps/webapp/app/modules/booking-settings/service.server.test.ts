import { db } from "~/database/db.server";
import { update, upsert } from "~/database/query-helpers.server";
import { ShelfError } from "~/utils/error";

import {
  getBookingSettingsForOrganization,
  updateBookingSettings,
} from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: testing booking settings service logic without executing actual database operations
vitest.mock("~/database/db.server", () => ({ db: {} }));
vitest.mock("~/database/query-helpers.server", () => ({
  upsert: vitest.fn(),
  update: vitest.fn(),
}));

const mockUpsert = vitest.mocked(upsert);
const mockUpdate = vitest.mocked(update);

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
    mockUpsert.mockResolvedValue(mockBookingSettingsData as any);

    const result = await getBookingSettingsForOrganization(mockOrganizationId);

    expect(upsert).toHaveBeenCalledWith(
      db,
      "BookingSettings",
      {
        bufferStartTime: 0,
        tagsRequired: false,
        maxBookingLength: null,
        maxBookingLengthSkipClosedDays: false,
        autoArchiveBookings: false,
        autoArchiveDays: 2,
        requireExplicitCheckinForAdmin: false,
        requireExplicitCheckinForSelfService: false,
        organizationId: mockOrganizationId,
      },
      { onConflict: "organizationId" }
    );
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
    mockUpsert.mockResolvedValue(defaultSettings as any);

    const result = await getBookingSettingsForOrganization(mockOrganizationId);

    expect(upsert).toHaveBeenCalledWith(
      db,
      "BookingSettings",
      {
        bufferStartTime: 0,
        tagsRequired: false,
        maxBookingLength: null,
        maxBookingLengthSkipClosedDays: false,
        autoArchiveBookings: false,
        autoArchiveDays: 2,
        requireExplicitCheckinForAdmin: false,
        requireExplicitCheckinForSelfService: false,
        organizationId: mockOrganizationId,
      },
      { onConflict: "organizationId" }
    );
    expect(result).toEqual(defaultSettings);
  });

  it("should throw ShelfError when database operation fails", async () => {
    expect.assertions(2);
    const dbError = new Error("Database connection failed");
    mockUpsert.mockRejectedValue(dbError);

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
    mockUpdate.mockResolvedValue(updatedSettings as any);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      bufferStartTime: 48,
    });

    expect(update).toHaveBeenCalledWith(db, "BookingSettings", {
      where: { organizationId: mockOrganizationId },
      data: { bufferStartTime: 48 },
    });
    expect(result).toEqual(updatedSettings);
  });

  it("should update tagsRequired only", async () => {
    expect.assertions(2);
    const updatedSettings = {
      ...mockBookingSettingsData,
      tagsRequired: false,
    };
    mockUpdate.mockResolvedValue(updatedSettings as any);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      tagsRequired: false,
    });

    expect(update).toHaveBeenCalledWith(db, "BookingSettings", {
      where: { organizationId: mockOrganizationId },
      data: { tagsRequired: false },
    });
    expect(result).toEqual(updatedSettings);
  });

  it("should update maxBookingLength only", async () => {
    expect.assertions(2);
    const updatedSettings = {
      ...mockBookingSettingsData,
      maxBookingLength: 72,
    };
    mockUpdate.mockResolvedValue(updatedSettings as any);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      maxBookingLength: 72,
    });

    expect(update).toHaveBeenCalledWith(db, "BookingSettings", {
      where: { organizationId: mockOrganizationId },
      data: { maxBookingLength: 72 },
    });
    expect(result).toEqual(updatedSettings);
  });

  it("should set maxBookingLength to null when passed null", async () => {
    expect.assertions(2);
    const updatedSettings = {
      ...mockBookingSettingsData,
      maxBookingLength: null,
    };
    mockUpdate.mockResolvedValue(updatedSettings as any);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      maxBookingLength: null,
    });

    expect(update).toHaveBeenCalledWith(db, "BookingSettings", {
      where: { organizationId: mockOrganizationId },
      data: { maxBookingLength: null },
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
    mockUpdate.mockResolvedValue(updatedSettings as any);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      bufferStartTime: 12,
      tagsRequired: false,
      maxBookingLength: 240,
    });

    expect(update).toHaveBeenCalledWith(db, "BookingSettings", {
      where: { organizationId: mockOrganizationId },
      data: {
        bufferStartTime: 12,
        tagsRequired: false,
        maxBookingLength: 240,
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
    mockUpdate.mockResolvedValue(updatedSettings as any);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      bufferStartTime: 36,
      tagsRequired: undefined,
      maxBookingLength: undefined,
    });

    expect(update).toHaveBeenCalledWith(db, "BookingSettings", {
      where: { organizationId: mockOrganizationId },
      data: { bufferStartTime: 36 },
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
    mockUpdate.mockResolvedValue(updatedSettings as any);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      bufferStartTime: 0,
      maxBookingLength: 0,
    });

    expect(update).toHaveBeenCalledWith(db, "BookingSettings", {
      where: { organizationId: mockOrganizationId },
      data: {
        bufferStartTime: 0,
        maxBookingLength: 0,
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
    mockUpdate.mockResolvedValue(updatedSettings as any);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
      tagsRequired: false,
    });

    expect(update).toHaveBeenCalledWith(db, "BookingSettings", {
      where: { organizationId: mockOrganizationId },
      data: { tagsRequired: false },
    });
    expect(result).toEqual(updatedSettings);
  });

  it("should throw ShelfError when database operation fails", async () => {
    expect.assertions(2);
    const dbError = new Error("Database connection failed");
    mockUpdate.mockRejectedValue(dbError);

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
        maxBookingLengthSkipClosedDays: undefined,
        autoArchiveBookings: undefined,
        autoArchiveDays: undefined,
      },
    });
  });

  it("should handle organization not found error", async () => {
    expect.assertions(2);
    const notFoundError = new Error("No rows found");
    //@ts-expect-error adding Postgres error properties
    notFoundError.code = "PGRST116";
    mockUpdate.mockRejectedValue(notFoundError);

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
        maxBookingLengthSkipClosedDays: undefined,
        autoArchiveBookings: undefined,
        autoArchiveDays: undefined,
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
    mockUpdate.mockResolvedValue(updatedSettings as any);

    const result = await updateBookingSettings({
      organizationId: mockOrganizationId,
    });

    expect(update).toHaveBeenCalledWith(db, "BookingSettings", {
      where: { organizationId: mockOrganizationId },
      data: {},
    });
    expect(result).toEqual(updatedSettings);
  });

  it("should include all parameters in error additional data", async () => {
    expect.assertions(1);
    const dbError = new Error("Database connection failed");
    mockUpdate.mockRejectedValue(dbError);

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
