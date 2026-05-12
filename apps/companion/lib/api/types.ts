// ── Types ──────────────────────────────────────────────

export type Organization = {
  id: string;
  name: string;
  type: string;
  roles: string[];
  barcodesEnabled: boolean;
};

export type MeResponse = {
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    profilePicture: string | null;
  };
  organizations: Organization[];
};

export type AssetListItem = {
  id: string;
  title: string;
  status: string;
  mainImage: string | null;
  thumbnailImage: string | null;
  category: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  custody: { custodian: { id: string; name: string } } | null;
};

export type AssetsResponse = {
  assets: AssetListItem[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
};

export type AssetNote = {
  id: string;
  content: string;
  type: "COMMENT" | "UPDATE";
  createdAt: string;
  user: {
    firstName: string | null;
    lastName: string | null;
  } | null;
};

export type AssetDetail = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  mainImage: string | null;
  thumbnailImage: string | null;
  availableToBook: boolean;
  valuation: number | null;
  createdAt: string;
  updatedAt: string;
  organizationId: string;
  category: { id: string; name: string; color: string } | null;
  location: { id: string; name: string } | null;
  custody: {
    createdAt: string;
    custodian: {
      id: string;
      name: string;
      user: {
        firstName: string | null;
        lastName: string | null;
        email: string;
        profilePicture: string | null;
      } | null;
    };
  } | null;
  kit: { id: string; name: string; status: string } | null;
  tags: { id: string; name: string }[];
  qrCodes: { id: string }[];
  organization: { currency: string };
  notes: AssetNote[];
  customFields: {
    id: string;
    value: any;
    customField: {
      id: string;
      name: string;
      type: string;
      helpText: string | null;
      active: boolean;
    };
  }[];
};

export type QrResponse = {
  qr: {
    id: string;
    assetId: string | null;
    kitId: string | null;
    organizationId: string | null;
    asset: {
      id: string;
      title: string;
      status: string;
      mainImage: string | null;
      category: { name: string } | null;
      location: { name: string } | null;
    } | null;
  };
};

export type BarcodeResponse = {
  barcode: {
    id: string;
    value: string;
    type: string;
    assetId: string | null;
    kitId: string | null;
    organizationId: string;
    asset: {
      id: string;
      title: string;
      status: string;
      mainImage: string | null;
      category: { name: string } | null;
      location: { name: string } | null;
    } | null;
  };
};

export type TeamMember = {
  id: string;
  name: string;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profilePicture: string | null;
  } | null;
};

export type TeamMembersResponse = {
  teamMembers: TeamMember[];
};

export type Location = {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  parentId: string | null;
};

export type LocationsResponse = {
  locations: Location[];
};

export type CustodyResponse = {
  asset: {
    id: string;
    title: string;
    status: string;
    custody: {
      custodian: { id: string; name: string };
    } | null;
  };
};

export type UpdateLocationResponse = {
  asset: {
    id: string;
    title: string;
    location: { id: string; name: string } | null;
  };
};

export type UpdateImageResponse = {
  asset: {
    id: string;
    title: string;
    mainImage: string | null;
    thumbnailImage: string | null;
  };
};

export type BulkActionResponse = {
  success: boolean;
  assigned?: number;
  released?: number;
  updated?: number;
  skipped?: number;
};

export type BookingStatus =
  | "DRAFT"
  | "RESERVED"
  | "ONGOING"
  | "OVERDUE"
  | "COMPLETE"
  | "ARCHIVED"
  | "CANCELLED";

export type BookingListItem = {
  id: string;
  name: string;
  status: BookingStatus;
  from: string;
  to: string;
  createdAt: string;
  custodianName: string | null;
  custodianImage: string | null;
  assetCount: number;
};

export type BookingsResponse = {
  bookings: BookingListItem[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
};

export type BookingAsset = {
  id: string;
  title: string;
  status: string;
  mainImage: string | null;
  kitId: string | null;
  category: { id: string; name: string; color: string } | null;
  kit: { id: string; name: string } | null;
};

export type BookingDetail = {
  id: string;
  name: string;
  description: string | null;
  status: BookingStatus;
  from: string;
  to: string;
  createdAt: string;
  updatedAt: string;
  creator: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  };
  custodianUser: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profilePicture: string | null;
  } | null;
  custodianTeamMember: {
    id: string;
    name: string;
  } | null;
  assets: BookingAsset[];
  assetCount: number;
  checkedOutCount: number;
};

export type BookingDetailResponse = {
  booking: BookingDetail;
  checkedInAssetIds: string[];
  canCheckout: boolean;
  canCheckin: boolean;
};

export type BookingActionResponse = {
  success: boolean;
  booking: {
    id: string;
    name: string;
    status: BookingStatus;
  };
};

export type PartialCheckinResponse = {
  success: boolean;
  checkedInCount: number;
  remainingCount: number;
  isComplete: boolean;
  booking: {
    id: string;
    name: string;
    status: BookingStatus;
  };
};

// ── Audit Types ────────────────────────────────────────

export type AuditStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "CANCELLED";
export type AuditAssetStatus = "PENDING" | "FOUND" | "MISSING" | "UNEXPECTED";

export type AuditListItem = {
  id: string;
  name: string;
  description: string | null;
  status: AuditStatus;
  expectedAssetCount: number;
  foundAssetCount: number;
  missingAssetCount: number;
  unexpectedAssetCount: number;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdBy: { firstName: string | null; lastName: string | null };
  assigneeCount: number;
};

export type AuditsResponse = {
  audits: AuditListItem[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
};

export type AuditExpectedAsset = {
  id: string;
  name: string;
  auditAssetId: string;
  mainImage: string | null;
  thumbnailImage: string | null;
};

export type AuditScanData = {
  code: string;
  assetId: string;
  assetTitle: string;
  isExpected: boolean;
  scannedAt: string;
  auditAssetId: string | null;
};

export type AuditDetailResponse = {
  audit: {
    id: string;
    name: string;
    description: string | null;
    status: AuditStatus;
    expectedAssetCount: number;
    foundAssetCount: number;
    missingAssetCount: number;
    unexpectedAssetCount: number;
    dueDate: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    createdBy: {
      firstName: string | null;
      lastName: string | null;
      profilePicture: string | null;
    };
    assignments: {
      userId: string;
      firstName: string | null;
      lastName: string | null;
      profilePicture: string | null;
      role: string | null;
    }[];
  };
  expectedAssets: AuditExpectedAsset[];
  existingScans: AuditScanData[];
  canScan: boolean;
  canComplete: boolean;
};

export type RecordScanResponse = {
  success: boolean;
  scanId: string;
  auditAssetId: string | null;
  foundAssetCount: number;
  unexpectedAssetCount: number;
};

export type CompleteAuditResponse = {
  success: boolean;
};

export type DashboardAudit = {
  id: string;
  name: string;
  status: AuditStatus;
  expectedAssetCount: number;
  foundAssetCount: number;
  dueDate: string | null;
};

export type Category = {
  id: string;
  name: string;
  color: string;
  assetCount: number;
};

export type CategoriesResponse = {
  categories: Category[];
};

export type CreateAssetResponse = {
  asset: {
    id: string;
    title: string;
  };
};

export type UpdateAssetPayload = {
  assetId: string;
  title?: string;
  description?: string;
  categoryId?: string;
  newLocationId?: string;
  currentLocationId?: string;
  valuation?: number | null;
  customFields?: { id: string; value: any }[];
};

/**
 * Definition of an active custom field as returned by
 * `GET /api/mobile/custom-fields`. The companion uses this shape to render
 * the right input (via `CustomFieldInput`) and to enforce required-ness
 * client-side before submitting the create / update payload.
 */
export type MobileCustomFieldDefinition = {
  id: string;
  name: string;
  type: string;
  helpText: string | null;
  required: boolean;
  options: string[] | null;
};

export type CustomFieldsResponse = {
  customFields: MobileCustomFieldDefinition[];
};

export type UpdateAssetResponse = {
  asset: {
    id: string;
    title: string;
    description: string | null;
  };
};

export type DeleteAssetResponse = {
  success: boolean;
};

export type DashboardKPIs = {
  totalAssets: number;
  categories: number;
  locations: number;
  teamMembers: number;
  myCustody: number;
};

export type DashboardBooking = {
  id: string;
  name: string;
  status: BookingStatus;
  from: string;
  to: string;
  custodianName: string | null;
  assetCount: number;
};

export type DashboardAsset = {
  id: string;
  title: string;
  status: string;
  mainImage: string | null;
  category: { id: string; name: string; color: string } | null;
  createdAt: string;
};

export type DashboardResponse = {
  kpis: DashboardKPIs;
  assetsByStatus: Record<string, number>;
  newestAssets: DashboardAsset[];
  upcomingBookings: DashboardBooking[];
  activeBookings: DashboardBooking[];
  overdueBookings: DashboardBooking[];
  activeAudits: DashboardAudit[];
};
