// ── Types ──────────────────────────────────────────────

export type Organization = {
  id: string;
  name: string;
  type: string;
  roles: string[];
  barcodesEnabled: boolean;
  /**
   * Canonical "can use Audits" capability from `/api/mobile/me`
   * (server-side `canUseAudits`: the paid add-on flag, OR always true when
   * premium gating is disabled). Premium-aware so client gating matches
   * the server. When false the companion hides Audits entry points and
   * every mobile audit endpoint returns 403.
   */
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

/**
 * Asset classification mirrored from the server's `AssetType` Prisma enum.
 * - `INDIVIDUAL`      — one row = one physical item (the default; behaves
 *                       exactly as the companion has always rendered).
 * - `QUANTITY_TRACKED` — one row = N fungible units, which can be partly
 *                       available / in custody / checked out at once and held
 *                       by multiple custodians each with a quantity.
 */
export type AssetType = "INDIVIDUAL" | "QUANTITY_TRACKED";

/**
 * Consumption behaviour for QUANTITY_TRACKED assets, mirrored from the
 * server's `ConsumptionType` Prisma enum. `null` for INDIVIDUAL assets.
 */
export type ConsumptionType = "ONE_WAY" | "TWO_WAY";

/**
 * One holder of a QUANTITY_TRACKED asset and the quantity they hold. A single
 * asset row can appear here multiple times (one entry per custodian). Mirrors
 * the server's `MobileAssetResponse.custodyList`.
 */
export type AssetCustodyListEntry = {
  custodian: {
    id: string;
    name: string;
    /**
     * Auth user id linked to this custodian's team-member record; null for
     * non-registered members. Lets the client identify its own row (e.g.
     * self-service users may only release their own custody). Absent on
     * older servers — treat as unknown, not as "someone else".
     */
    userId?: string | null;
  };
  /** Total units held by this custodian (operator-assigned + kit-allocated). */
  quantity: number;
  /**
   * Units releasable via the release-quantity endpoint (operator rows only).
   * `quantity - releasableQuantity` = units held via a kit, which are only
   * released by releasing the kit's own custody. Absent on older servers —
   * fall back to `quantity` (the server still enforces the real cap).
   */
  releasableQuantity?: number;
};

/**
 * Quantity-tracking fields shared by the list-item and detail asset shapes.
 *
 * All fields are OPTIONAL: a server that predates the quantity feature simply
 * omits them, so consumers MUST guard on `type === "QUANTITY_TRACKED"` AND the
 * presence of each field before reading it. INDIVIDUAL assets carry
 * `type: "INDIVIDUAL"` with null quantity columns and render unchanged.
 */
export type AssetQuantityFields = {
  /** Asset classification. Absent on pre-quantity servers. */
  type?: AssetType;
  /** Total units for a QUANTITY_TRACKED asset; null for INDIVIDUAL. */
  quantity?: number | null;
  /** Reorder threshold for a QUANTITY_TRACKED asset; null for INDIVIDUAL. */
  minQuantity?: number | null;
  /** Display unit (e.g. "pcs", "boxes", "liters"); null when unset. */
  unitOfMeasure?: string | null;
  /** Consumption behaviour; null for INDIVIDUAL assets. */
  consumptionType?: ConsumptionType | null;
  /**
   * Every holder + the quantity they hold. Emitted on the list endpoint for
   * all assets (empty array when no custody). May be absent on the detail
   * endpoint / pre-quantity servers — consumers fall back to single custody.
   */
  custodyList?: AssetCustodyListEntry[];
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
} & AssetQuantityFields;

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

/**
 * Per-status quantity slices for a QUANTITY_TRACKED asset, returned only by the
 * detail endpoint. Mirrors the server's `quantityBreakdown` shape (computed by
 * the same `getQuantityData` helper the web badge uses).
 *
 * `null` when the asset is INDIVIDUAL, or when a QUANTITY_TRACKED asset has no
 * custody/booking activity yet (the server's `getQuantityData` null contract).
 * Consumers must handle `null` by falling back to the plain total quantity.
 */
export type AssetQuantityBreakdown = {
  /** Total units. */
  total: number;
  /** Units neither in custody, reserved, nor checked out. */
  available: number;
  /** Units currently held in custody. */
  inCustody: number;
  /** Units reserved by upcoming bookings. */
  reserved: number;
  /** Units checked out on active bookings. */
  checkedOut: number;
  /**
   * Assign cap for the quantity-custody dialog. Mirrors the web overview
   * loader: total - in kits - operator custody - checked out; reservations
   * are deliberately NOT subtracted (they re-validate at their own checkout).
   * Absent on older servers — fall back to `available`, then the plain total.
   */
  custodyAvailable?: number;
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
  /**
   * Aggregated per-status quantity slices for QUANTITY_TRACKED assets.
   * Optional + nullable: absent on pre-quantity servers, `null` for INDIVIDUAL
   * assets or QUANTITY_TRACKED assets with no activity. See type docs.
   */
  quantityBreakdown?: AssetQuantityBreakdown | null;
  /**
   * Number of custody holders hidden from the caller for privacy (e.g.
   * self-service users only see their own rows). When > 0 the detail screen
   * shows a muted "+N other(s) hold this asset" row. Absent on older servers.
   */
  custodyListOthersCount?: number;
} & AssetQuantityFields;

/**
 * Kit shape returned by the scanner's QR/barcode resolvers. The per-asset
 * statuses power the kit batch blockers ("kit has assets in custody"),
 * mirroring the web scanner drawers.
 */
export type ScannedKit = {
  id: string;
  name: string;
  status: string;
  image: string | null;
  _count: { assets: number };
  assets: { id: string; status: string; availableToBook: boolean }[];
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
      /** Set when the asset belongs to a kit (drives scanner batch blockers) */
      kitId: string | null;
      /** Drives the scan-to-booking "not available to book" blocker */
      availableToBook: boolean;
      category: { name: string } | null;
      location: { name: string } | null;
    } | null;
    /** Set when the QR is linked to a kit instead of an asset */
    kit: ScannedKit | null;
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
      /** Set when the asset belongs to a kit (drives scanner batch blockers) */
      kitId: string | null;
      /** Drives the scan-to-booking "not available to book" blocker */
      availableToBook: boolean;
      category: { name: string } | null;
      location: { name: string } | null;
    } | null;
    /** Set when the barcode is linked to a kit instead of an asset */
    kit: ScannedKit | null;
  };
};

// ── Kits ────────────────────────────────────────────────

export type KitStatus = "AVAILABLE" | "IN_CUSTODY" | "CHECKED_OUT";

export type KitListItem = {
  id: string;
  name: string;
  status: KitStatus;
  image: string | null;
  imageExpiration: string | null;
  _count: { assets: number };
  category: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  custody: { custodian: { id: string; name: string } } | null;
};

export type KitsResponse = {
  kits: KitListItem[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
};

export type KitDetailAsset = {
  id: string;
  title: string;
  status: string;
  valuation: number | null;
  mainImage: string | null;
  thumbnailImage: string | null;
  category: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
};

export type KitDetail = {
  id: string;
  name: string;
  description: string | null;
  status: KitStatus;
  image: string | null;
  imageExpiration: string | null;
  createdAt: string;
  updatedAt: string;
  category: { id: string; name: string; color: string } | null;
  location: { id: string; name: string } | null;
  qrCodes: { id: string }[];
  organization: { currency: string };
  /** Sum of the contained assets' valuation (computed server-side). */
  totalValue: number;
  custody: {
    createdAt: string;
    custodian: {
      id: string;
      name: string;
      user: {
        firstName: string | null;
        lastName: string | null;
        email: string;
      } | null;
    };
  } | null;
  assets: KitDetailAsset[];
};

export type KitDetailResponse = { kit: KitDetail };

/** Intents accepted by POST /api/mobile/kits/bulk-actions */
export type KitBulkIntent =
  | "assign-custody"
  | "release-custody"
  | "update-location";

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

/**
 * Response of the mobile assign-quantity / release-quantity custody endpoints
 * (QUANTITY_TRACKED assets only). `asset` is the refreshed detail-shaped
 * asset when the server includes it; the client refetches the detail after
 * success regardless, so consumers must tolerate the field being absent.
 */
export type QuantityCustodyResponse = {
  success: boolean;
  asset?: AssetDetail;
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

/**
 * Response of the three mobile bulk endpoints (bulk-assign-custody,
 * bulk-release-custody, bulk-update-location). Mixed selections skip
 * QUANTITY_TRACKED assets server-side and report the count via
 * `skippedQuantityTracked`; selections that are 100% quantity-tracked
 * surface as an error envelope instead (never a skip count). For every
 * other eligibility rule the client-side blockers (lib/batch-blockers.ts)
 * keep batches clean before submit.
 */
export type BulkActionResponse = {
  success: boolean;
  /**
   * Count of QUANTITY_TRACKED assets the server skipped (additive; absent on
   * older servers). Always 0 for all-INDIVIDUAL batches.
   */
  skippedQuantityTracked?: number;
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
  /**
   * Outstanding book-by-model reservations still to assign (units reserved at
   * the model level with no concrete asset behind them yet). > 0 means the
   * booking can't be checked out until matching assets are assigned. Optional
   * for back-compat with an older server response.
   */
  outstandingModelCount?: number;
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
  // Quantity-tracked fields. The server sends `quantity` for every asset;
  // `type`/`unitOfMeasure`/`consumptionType` + the `remaining*` counts are what
  // the check-in / check-out pickers use. Optional for back-compat with older
  // server responses (the app falls back to bare-scan behaviour when absent).
  type?: AssetType;
  quantity?: number;
  unitOfMeasure?: string | null;
  consumptionType?: ConsumptionType | null;
  assetKitId?: string | null;
  /** Units currently checked out on this booking that can still be checked in. */
  remainingToCheckIn?: number;
  /** Units still reserved on this booking that can still be checked out. */
  remainingToCheckOut?: number;
};

/**
 * Per-asset check-in disposition for a QUANTITY_TRACKED asset: how many of the
 * checked-out units were returned / consumed / lost / damaged. Sum must be
 * <= the asset's `remainingToCheckIn`. Mirrors the web check-in drawer.
 */
export type CheckinDisposition = {
  assetId: string;
  bookingAssetId?: string | null;
  returned?: number;
  consumed?: number;
  lost?: number;
  damaged?: number;
};

/**
 * Per-asset check-out disposition for a QUANTITY_TRACKED asset: how many units
 * to take now. `quantity` must be <= the asset's `remainingToCheckOut`.
 */
export type CheckoutDisposition = {
  assetId: string;
  bookingAssetId?: string | null;
  quantity: number;
};

/**
 * A book-by-model reservation on a booking: intent to reserve `quantity` units
 * of an `AssetModel` without picking specific assets upfront. `outstanding` is
 * how many are still waiting to be assigned via scan-to-assign;
 * `fulfilledAt` non-null means every unit has been assigned (read-only history).
 */
export type BookingModelRequest = {
  id: string;
  assetModelId: string;
  assetModelName: string;
  quantity: number;
  fulfilledQuantity: number;
  outstandingQuantity: number;
  fulfilledAt: string | null;
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
  tags: { id: string; name: string }[];
  assets: BookingAsset[];
  assetCount: number;
  checkedOutCount: number;
  /** Book-by-model reservations (outstanding + fulfilled), matching the web. */
  modelRequests: BookingModelRequest[];
  /** Number of distinct models reserved (rows in `modelRequests`). */
  modelRequestCount: number;
  /** Total units still to assign across all model requests. */
  outstandingModelUnitCount: number;
  /**
   * Segmented lifecycle progress (Booked / Partial / Fully out / Returned),
   * computed server-side by the SAME shared helper the web booking overview
   * uses, so the mobile progress bar shows identical numbers to web. `null` /
   * absent from an older server (rolling deploy) — the card is then omitted.
   */
  lifecycleProgress?: {
    totalUnits: number;
    bookedCount: number;
    partialCount: number;
    checkedOutCount: number;
    returnedCount: number;
    checkoutProgressCount: number;
    checkoutProgressPercentage: number;
    checkinProgressCount: number;
    checkinProgressPercentage: number;
    hasPartialCheckouts: boolean;
    hasPartialCheckins: boolean;
    countMode: "assets" | "units";
  } | null;
};

export type BookingDetailResponse = {
  booking: BookingDetail;
  checkedInAssetIds: string[];
  canCheckout: boolean;
  canCheckin: boolean;
  /**
   * False when the workspace requires explicit (scan/select) check-in for the
   * caller's role — the app hides the quick "Check In All" button to match the
   * web, which never offers quick check-in under that policy.
   */
  canQuickCheckin: boolean;
  /**
   * Per-booking lifecycle-action availability, computed server-side mirroring
   * the web ActionsDropdown gating (role + status + permission). The detail
   * screen shows only the enabled actions; the server endpoints enforce the
   * same gates regardless.
   */
  bookingActions: {
    canCancel: boolean;
    canArchive: boolean;
    canDuplicate: boolean;
    canDelete: boolean;
  };
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

export type PartialCheckoutResponse = {
  success: boolean;
  checkedOutCount: number;
  remainingCount: number;
  isComplete: boolean;
  booking: {
    id: string;
    name: string;
    status: BookingStatus;
  };
};

// ── Booking create / edit / reserve ─────────────────────

/** Common response from create / update / reserve mobile booking endpoints. */
export type BookingMutationResponse = {
  booking: {
    id: string;
    name: string;
    status: BookingStatus;
  };
};

/**
 * Payload for `POST /api/mobile/bookings/create`. Dates are local wire strings
 * in `yyyy-MM-dd'T'HH:mm` (no offset); `timeZone` is the device IANA zone so the
 * server can resolve them — there is no client-hint cookie on native. Assets are
 * optional at create (the picker/scanner add them afterwards, mirroring web).
 */
export type CreateBookingPayload = {
  name: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  custodianTeamMemberId: string;
  description?: string;
  tags?: string[];
  assetIds?: string[];
};

/** Payload for `POST /api/mobile/bookings/update`. */
export type UpdateBookingPayload = {
  bookingId: string;
  name: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  custodianTeamMemberId: string;
  description?: string;
  tags?: string[];
};

export type RemoveBookingAssetsResponse = {
  booking: {
    id: string;
    name: string;
    status: BookingStatus;
  };
  removedCount: number;
};

/** Availability-aware asset row for the booking picker. */
export type AvailableAsset = {
  id: string;
  title: string;
  status: string;
  mainImage: string | null;
  mainImageExpiration: string | null;
  thumbnailImage: string | null;
  kitId: string | null;
};

export type AvailableAssetsResponse = {
  assets: AvailableAsset[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
};

/** Availability-aware kit row for the booking picker. */
export type AvailableKit = {
  id: string;
  name: string;
  status: string;
};

export type AvailableKitsResponse = {
  kits: AvailableKit[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
};

/**
 * A bookable asset model in the book-by-model picker, with how many units are
 * free to reserve in the booking's window. `available` = total − in-custody −
 * reserved (concrete + via other model requests). Server-computed; the app
 * caps the reserve input at `available` + the amount already fulfilled.
 */
export type AvailableModel = {
  id: string;
  name: string;
  total: number;
  available: number;
  inCustody: number;
  reservedConcrete: number;
  reservedViaRequest: number;
};

/**
 * The booking's existing model-level reservations as returned by the picker
 * (leaner than {@link BookingModelRequest} — no id/outstanding, since the
 * picker only needs current amounts to pre-fill inputs).
 */
export type AvailableModelExistingRequest = {
  assetModelId: string;
  assetModelName: string;
  quantity: number;
  fulfilledQuantity: number;
  fulfilledAt: string | null;
};

export type AvailableModelsResponse = {
  /** False when the workspace has no AssetModel at all — hide the picker. */
  showModelsTab: boolean;
  /** Per-model availability for this booking's window (first 50 by name). */
  assetModels: AvailableModel[];
  /** Full workspace model count (the list above is capped at 50). */
  totalAssetModels: number;
  /** This booking's existing model reservations, to pre-fill the inputs. */
  modelRequests: AvailableModelExistingRequest[];
};

/** Response from the model-request upsert/remove endpoint. */
export type ModelRequestMutationResponse = {
  success: boolean;
};

export type BookingTag = { id: string; name: string };

export type BookingTagsResponse = {
  tags: BookingTag[];
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
  /** Asset's location name at scan time, or null if it has no location set. */
  assetLocationName: string | null;
  /** Number of COMMENT notes recorded against this scanned asset. */
  auditNotesCount: number;
  /** Number of condition photos uploaded for this scanned asset. */
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

// ── Audit Notes & Images Types ────────────────────────────

export type AuditNoteUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  email: string;
  profilePicture: string | null;
};

export type AuditNote = {
  id: string;
  content: string;
  createdAt: string;
  user: AuditNoteUser | null;
};

export type CreateAuditNoteResponse = {
  note: AuditNote;
};

export type AuditImage = {
  id: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  description: string | null;
  auditSessionId: string;
  auditAssetId: string | null;
  uploadedById: string | null;
  createdAt: string;
};

export type UploadAuditImageResponse = {
  image: AuditImage;
};

export type DashboardAudit = {
  id: string;
  name: string;
  status: AuditStatus;
  expectedAssetCount: number;
  foundAssetCount: number;
  dueDate: string | null;
  /**
   * Number of users assigned; 0 = unassigned ("anyone can scan").
   * Optional: older webapp builds (before this field shipped) omit it, so
   * the client must tolerate its absence and hide ownership rather than
   * render "undefined assigned" against a not-yet-deployed server.
   */
  assigneeCount?: number;
  /** Whether the current user is among the assignees ("Assigned to you"). Optional — see `assigneeCount`. */
  isAssignedToMe?: boolean;
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

/** A tag assignable to an asset (asset-create tag picker). */
export type Tag = {
  id: string;
  name: string;
};

/** Response payload for `GET /api/mobile/tags` (the asset tag picker source). */
export type TagsResponse = {
  tags: Tag[];
  /**
   * Server-computed: whether the caller may mint a new tag via
   * `POST /api/mobile/tags/create` (admins/owners). Gates the picker's inline
   * "create tag" affordance so self-service users never see a control that
   * would 403. Optional so the app tolerates older servers (treated as false).
   */
  canCreate?: boolean;
};

/** Response payload for `POST /api/mobile/tags/create`. */
export type CreateTagResponse = {
  tag: Tag;
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
  /**
   * Full desired tag-id set (replace). Omit to leave tags unchanged; pass `[]`
   * to clear all tags.
   */
  tags?: string[];
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
