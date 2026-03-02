import { describe, expect, it } from "vitest";

import {
  getAssetCommandValue,
  getBookingCommandValue,
  getKitCommandValue,
  getLocationCommandValue,
  getTeamMemberCommandValue,
  getTeamMemberHref,
  type AssetSearchResult,
  type BookingSearchResult,
  type KitSearchResult,
  type LocationSearchResult,
  type TeamMemberSearchResult,
} from "./command-palette";

describe("getAssetCommandValue", () => {
  const baseAsset: AssetSearchResult = {
    id: "asset-123",
    title: "4K Camera",
    sequentialId: "AS-100",
    mainImage: null,
    mainImageExpiration: null,
    locationName: "Studio",
    description: null,
    qrCodes: [],
    categoryName: null,
    tagNames: [],
    custodianName: null,
    custodianUserName: null,
    barcodes: [],
    customFieldValues: [],
  };

  it("includes the primary searchable fields", () => {
    const value = getAssetCommandValue(baseAsset);

    expect(value).toContain("asset-123");
    expect(value).toContain("4K Camera");
    expect(value).toContain("AS-100");
    expect(value).toContain("Studio");
  });

  it("falls back gracefully when optional fields are missing", () => {
    const value = getAssetCommandValue({
      ...baseAsset,
      sequentialId: null,
      locationName: null,
    });

    expect(value).toContain("asset-123");
    expect(value).toContain("4K Camera");
    expect(value).not.toContain("null");
  });
});

describe("getKitCommandValue", () => {
  const baseKit: KitSearchResult = {
    id: "kit-456",
    name: "Camera Kit",
    description: "Professional camera equipment",
    status: "AVAILABLE",
    assetCount: 5,
  };

  it("includes the primary searchable fields", () => {
    const value = getKitCommandValue(baseKit);

    expect(value).toContain("kit-456");
    expect(value).toContain("Camera Kit");
    expect(value).toContain("Professional camera equipment");
  });

  it("falls back gracefully when optional fields are missing", () => {
    const value = getKitCommandValue({
      ...baseKit,
      description: null,
    });

    expect(value).toContain("kit-456");
    expect(value).toContain("Camera Kit");
    expect(value).not.toContain("null");
  });
});

describe("getBookingCommandValue", () => {
  const baseBooking: BookingSearchResult = {
    id: "booking-789",
    name: "Photo Shoot",
    description: "Wedding photography session",
    status: "RESERVED",
    custodianName: "John Doe",
    from: new Date("2024-01-15T10:00:00Z"),
    to: new Date("2024-01-15T18:00:00Z"),
  };

  it("includes the primary searchable fields", () => {
    const value = getBookingCommandValue(baseBooking);

    expect(value).toContain("booking-789");
    expect(value).toContain("Photo Shoot");
    expect(value).toContain("Wedding photography session");
    expect(value).toContain("John Doe");
  });

  it("falls back gracefully when optional fields are missing", () => {
    const value = getBookingCommandValue({
      ...baseBooking,
      description: null,
      custodianName: null,
    });

    expect(value).toContain("booking-789");
    expect(value).toContain("Photo Shoot");
    expect(value).not.toContain("null");
  });
});

describe("getLocationCommandValue", () => {
  const baseLocation: LocationSearchResult = {
    id: "location-101",
    name: "Main Studio",
    description: "Primary photography studio",
    address: "123 Main St, City",
    assetCount: 12,
  };

  it("includes the primary searchable fields", () => {
    const value = getLocationCommandValue(baseLocation);

    expect(value).toContain("location-101");
    expect(value).toContain("Main Studio");
    expect(value).toContain("Primary photography studio");
    expect(value).toContain("123 Main St, City");
  });

  it("falls back gracefully when optional fields are missing", () => {
    const value = getLocationCommandValue({
      ...baseLocation,
      description: null,
      address: null,
    });

    expect(value).toContain("location-101");
    expect(value).toContain("Main Studio");
    expect(value).not.toContain("null");
  });
});

describe("getTeamMemberCommandValue", () => {
  const baseMember: TeamMemberSearchResult = {
    id: "member-202",
    name: "Jane Smith",
    email: "jane@example.com",
    firstName: "Jane",
    lastName: "Smith",
    userId: "user-123",
  };

  it("includes the primary searchable fields", () => {
    const value = getTeamMemberCommandValue(baseMember);

    expect(value).toContain("member-202");
    expect(value).toContain("Jane Smith");
    expect(value).toContain("jane@example.com");
    expect(value).toContain("Jane");
    expect(value).toContain("Smith");
  });

  it("falls back gracefully when optional fields are missing", () => {
    const value = getTeamMemberCommandValue({
      ...baseMember,
      email: null,
      firstName: null,
      lastName: null,
    });

    expect(value).toContain("member-202");
    expect(value).toContain("Jane Smith");
    expect(value).not.toContain("null");
  });
});

describe("getTeamMemberHref", () => {
  const registeredMember: TeamMemberSearchResult = {
    id: "member-202",
    name: "Jane Smith",
    email: "jane@example.com",
    firstName: "Jane",
    lastName: "Smith",
    userId: "user-123",
  };

  const nrmMember: TeamMemberSearchResult = {
    id: "member-303",
    name: "John Appleseed",
    email: null,
    firstName: null,
    lastName: null,
    userId: null,
  };

  it("routes registered team members to their user settings page", () => {
    expect(getTeamMemberHref(registeredMember)).toBe(
      "/settings/team/users/user-123"
    );
  });

  it("routes non-registered members to the NRM edit modal", () => {
    expect(getTeamMemberHref(nrmMember)).toBe(
      "/settings/team/nrm/member-303/edit"
    );
  });

  it("falls back to the registered list when a user id is missing", () => {
    expect(
      getTeamMemberHref({
        ...registeredMember,
        userId: "",
      })
    ).toBe("/settings/team/users");
  });

  it("falls back to the NRM list when an NRM id is missing", () => {
    expect(
      getTeamMemberHref({
        ...nrmMember,
        id: "",
      })
    ).toBe("/settings/team/nrm");
  });
});
