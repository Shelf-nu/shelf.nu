// ── Types ──────────────────────────────────────────────

export type Organization = {
  id: string;
  name: string;
  type: string;
  roles: string[];
  barcodesEnabled: boolean;
  auditsEnabled: boolean;
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
  /**
   * True when the authenticated mobile user is among the audit's
   * assignees. Server-computed on the list endpoint so the companion
   * can render a "Yours" marker without an extra round-trip per row.
   */
  isAssignedToMe: boolean;
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
  /**
   * Where the asset is supposed to be physically. Surfaced on the
   * audit detail row so the field worker can navigate to the right
   * shelf / room without leaving the audit context. Null when the
   * asset has no location set or the server didn't load it.
   */
  locationName: string | null;
  /**
   * Asset category name — helps when the image is generic and you
   * need to disambiguate "which laptop" among many identical rows.
   */
  categoryName: string | null;
  /**
   * Display name of the team member currently holding the asset, if
   * any. Helps explain why an expected asset can't be found at its
   * location (someone has it on loan).
   */
  custodianName: string | null;
};

export type AuditScanData = {
  code: string;
  assetId: string;
  assetTitle: string;
  isExpected: boolean;
  scannedAt: string;
  auditAssetId: string | null;
  assetLocationName: string | null;
  auditNotesCount: number;
  auditImagesCount: number;
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

/**
 * Server-accepted scalar value for a custom field on create / update.
 * The webapp coerces these into the appropriate stored representation:
 * - string  → TEXT / MULTILINE_TEXT / DATE (ISO) / OPTION (option text)
 * - number  → NUMBER / AMOUNT
 * - boolean → BOOLEAN
 * - null    → clear the value (UPDATE only)
 */
export type CustomFieldValue = string | number | boolean | null;

export type UpdateAssetPayload = {
  assetId: string;
  title?: string;
  description?: string;
  categoryId?: string;
  newLocationId?: string;
  currentLocationId?: string;
  valuation?: number | null;
  /**
   * Custom field updates. Each entry is the customField `id` (NOT the asset's
   * custom-field-value row id) plus the new value. Omitted fields are left
   * unchanged on the server.
   */
  customFields?: { id: string; value: CustomFieldValue }[];
};

/**
 * Definition of an active custom field as returned by
 * `GET /api/mobile/custom-fields`. The companion uses this shape to render
 * the right input (via `CustomFieldInput`) and to enforce required-ness
 * client-side before submitting the create / update payload.
 *
 * Field semantics:
 * - `id`        — stable CustomField primary key; used as the dictionary
 *                 key on the form's local id → value map.
 * - `name`      — human-readable label shown above the input.
 * - `type`      — one of `TEXT`, `MULTILINE_TEXT`, `BOOLEAN`, `DATE`,
 *                 `NUMBER`, `AMOUNT`, `OPTION`. Drives input rendering.
 * - `helpText`  — optional hint shown next to the label (and forwarded as
 *                 an `accessibilityHint` to screen readers).
 * - `required`  — when true, the create / update screens block submit
 *                 until a non-empty value is provided. The server enforces
 *                 the same contract; the client check is a UX improvement.
 * - `options`   — only populated for `type === "OPTION"`. The allowed set
 *                 of values the user may pick from. Empty array / null for
 *                 every other type.
 */
/**
 * Discriminated union of all supported custom-field types. Keeping this as
 * a literal union (not `string`) catches typos at compile time — the most
 * common confusion is webapp internals using lowercase identifiers
 * (`"option"`, `"boolean"`) while the database and this API contract use
 * uppercase. Add a new constant here when introducing a new field type.
 */
export type MobileCustomFieldType =
  | "TEXT"
  | "MULTILINE_TEXT"
  | "BOOLEAN"
  | "DATE"
  | "NUMBER"
  | "AMOUNT"
  | "OPTION";

export type MobileCustomFieldDefinition = {
  id: string;
  name: string;
  type: MobileCustomFieldType;
  helpText: string | null;
  required: boolean;
  options: string[] | null;
};

/**
 * Response payload for `GET /api/mobile/custom-fields?orgId=...&categoryId=...`.
 * Returns the full set of active custom-field definitions that apply to the
 * selected category (or to "no category" when `categoryId` is omitted).
 */
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
