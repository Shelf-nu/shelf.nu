/**
 * Supabase Database Types
 *
 * Generated from the SQL migrations in supabase/migrations/.
 * To regenerate, run: pnpm db:gen-types
 *
 * These types mirror the structure produced by `supabase gen types typescript`
 * and are compatible with @supabase/supabase-js's generic type parameter.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type AssetStatus = "AVAILABLE" | "IN_CUSTODY" | "CHECKED_OUT";
export type AssetIndexMode = "SIMPLE" | "ADVANCED";
export type NoteType = "COMMENT" | "UPDATE";
export type ErrorCorrection = "L" | "M" | "Q" | "H";
export type BarcodeType =
  | "Code128"
  | "Code39"
  | "DataMatrix"
  | "ExternalQR"
  | "EAN13";
export type TagUseFor = "ASSET" | "BOOKING";
export type Roles = "USER" | "ADMIN";
export type OrganizationType = "PERSONAL" | "TEAM";
export type QrIdDisplayPreference = "QR_ID" | "SAM_ID";
export type OrganizationRoles = "ADMIN" | "BASE" | "OWNER" | "SELF_SERVICE";
export type InviteStatuses =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "INVALIDATED";
export type BookingStatus =
  | "DRAFT"
  | "RESERVED"
  | "ONGOING"
  | "OVERDUE"
  | "COMPLETE"
  | "ARCHIVED"
  | "CANCELLED";
export type KitStatus = "AVAILABLE" | "IN_CUSTODY" | "CHECKED_OUT";
export type TierId = "free" | "tier_1" | "tier_2" | "custom";
export type CustomFieldType =
  | "TEXT"
  | "OPTION"
  | "BOOLEAN"
  | "DATE"
  | "MULTILINE_TEXT"
  | "AMOUNT"
  | "NUMBER";
export type UpdateStatus = "DRAFT" | "PUBLISHED";
export type AuditStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "CANCELLED";
export type AuditAssetStatus = "PENDING" | "FOUND" | "MISSING" | "UNEXPECTED";
export type AuditAssignmentRole = "LEAD" | "PARTICIPANT";
export type Currency =
  | "AED"
  | "AFN"
  | "ALL"
  | "AMD"
  | "ANG"
  | "AOA"
  | "ARS"
  | "AUD"
  | "AWG"
  | "AZN"
  | "BAM"
  | "BBD"
  | "BDT"
  | "BGN"
  | "BHD"
  | "BIF"
  | "BMD"
  | "BND"
  | "BOB"
  | "BRL"
  | "BSD"
  | "BTN"
  | "BWP"
  | "BYN"
  | "BZD"
  | "CAD"
  | "CDF"
  | "CHF"
  | "CLP"
  | "CNY"
  | "COP"
  | "CRC"
  | "CUP"
  | "CVE"
  | "CZK"
  | "DJF"
  | "DKK"
  | "DOP"
  | "DZD"
  | "EGP"
  | "ERN"
  | "ETB"
  | "EUR"
  | "FJD"
  | "FKP"
  | "GBP"
  | "GEL"
  | "GHS"
  | "GIP"
  | "GMD"
  | "GNF"
  | "GTQ"
  | "GYD"
  | "HKD"
  | "HNL"
  | "HTG"
  | "HUF"
  | "IDR"
  | "ILS"
  | "INR"
  | "IQD"
  | "IRR"
  | "ISK"
  | "JMD"
  | "JOD"
  | "JPY"
  | "KES"
  | "KGS"
  | "KHR"
  | "KMF"
  | "KPW"
  | "KRW"
  | "KWD"
  | "KYD"
  | "KZT"
  | "LAK"
  | "LBP"
  | "LKR"
  | "LRD"
  | "LSL"
  | "LYD"
  | "MAD"
  | "MDL"
  | "MGA"
  | "MKD"
  | "MMK"
  | "MNT"
  | "MOP"
  | "MRU"
  | "MUR"
  | "MVR"
  | "MWK"
  | "MXN"
  | "MYR"
  | "MZN"
  | "NAD"
  | "NGN"
  | "NIO"
  | "NOK"
  | "NPR"
  | "NZD"
  | "OMR"
  | "PAB"
  | "PEN"
  | "PGK"
  | "PHP"
  | "PKR"
  | "PLN"
  | "PYG"
  | "QAR"
  | "RON"
  | "RSD"
  | "RUB"
  | "RWF"
  | "SAR"
  | "SBD"
  | "SCR"
  | "SDG"
  | "SEK"
  | "SGD"
  | "SHP"
  | "SLE"
  | "SOS"
  | "SRD"
  | "SSP"
  | "STN"
  | "SVC"
  | "SYP"
  | "SZL"
  | "THB"
  | "TJS"
  | "TMT"
  | "TND"
  | "TOP"
  | "TRY"
  | "TTD"
  | "TWD"
  | "TZS"
  | "UAH"
  | "UGX"
  | "USD"
  | "UYU"
  | "UZS"
  | "VES"
  | "VND"
  | "VUV"
  | "WST"
  | "XAF"
  | "XCD"
  | "XOF"
  | "XPF"
  | "YER"
  | "ZAR"
  | "ZMW"
  | "ZWL";

// ---------------------------------------------------------------------------
// Table Row types  (what you get back from a SELECT)
// ---------------------------------------------------------------------------

export type TierLimitRow = {
  id: TierId;
  canImportAssets: boolean;
  canExportAssets: boolean;
  canImportNRM: boolean;
  canHideShelfBranding: boolean;
  maxCustomFields: number;
  maxOrganizations: number;
  createdAt: string;
  updatedAt: string;
};

export type TierRow = {
  id: TierId;
  name: string;
  tierLimitId: TierId | null;
  createdAt: string;
  updatedAt: string;
};

export type RoleRow = {
  id: string;
  name: Roles;
  createdAt: string;
  updatedAt: string;
};

export type SsoDetailsRow = {
  id: string;
  domain: string;
  baseUserGroupId: string | null;
  selfServiceGroupId: string | null;
  adminGroupId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserRow = {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  profilePicture: string | null;
  usedFreeTrial: boolean;
  onboarded: boolean;
  customerId: string | null;
  sso: boolean;
  createdWithInvite: boolean;
  skipSubscriptionCheck: boolean;
  hasUnpaidInvoice: boolean;
  warnForNoPaymentMethod: boolean;
  lastSelectedOrganizationId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tierId: TierId;
  referralSource: string | null;
};

export type ImageRow = {
  id: string;
  contentType: string;
  altText: string | null;
  blob: string; // bytea comes as base64 string from PostgREST
  createdAt: string;
  updatedAt: string;
  ownerOrgId: string;
  userId: string;
};

export type OrganizationRow = {
  id: string;
  name: string;
  type: OrganizationType;
  userId: string;
  currency: Currency;
  imageId: string | null;
  enabledSso: boolean;
  ssoDetailsId: string | null;
  selfServiceCanSeeCustody: boolean;
  selfServiceCanSeeBookings: boolean;
  baseUserCanSeeCustody: boolean;
  baseUserCanSeeBookings: boolean;
  barcodesEnabled: boolean;
  barcodesEnabledAt: string | null;
  auditsEnabled: boolean;
  auditsEnabledAt: string | null;
  usedAuditTrial: boolean;
  workspaceDisabled: boolean;
  hasSequentialIdsMigrated: boolean;
  qrIdDisplayPreference: QrIdDisplayPreference;
  showShelfBranding: boolean;
  customEmailFooter: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserContactRow = {
  id: string;
  phone: string | null;
  street: string | null;
  city: string | null;
  stateProvince: string | null;
  zipPostalCode: string | null;
  countryRegion: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
};

export type UserBusinessIntelRow = {
  id: string;
  howDidYouHearAboutUs: string | null;
  jobTitle: string | null;
  teamSize: string | null;
  companyName: string | null;
  primaryUseCase: string | null;
  currentSolution: string | null;
  timeline: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomTierLimitRow = {
  id: string;
  userId: string | null;
  canImportAssets: boolean;
  canExportAssets: boolean;
  canImportNRM: boolean;
  canHideShelfBranding: boolean;
  maxCustomFields: number;
  maxOrganizations: number;
  isEnterprise: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UserOrganizationRow = {
  id: string;
  userId: string;
  organizationId: string;
  roles: OrganizationRoles[];
  createdAt: string;
  updatedAt: string;
};

export type LocationRow = {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  imageId: string | null;
  userId: string;
  organizationId: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CategoryRow = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  organizationId: string;
};

export type TagRow = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  useFor: TagUseFor[];
  userId: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
};

export type AssetRow = {
  id: string;
  title: string;
  description: string | null;
  mainImage: string | null;
  thumbnailImage: string | null;
  mainImageExpiration: string | null;
  status: AssetStatus;
  value: number | null;
  availableToBook: boolean;
  sequentialId: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  organizationId: string;
  categoryId: string | null;
  locationId: string | null;
  kitId: string | null;
};

export type KitRow = {
  id: string;
  name: string;
  description: string | null;
  status: KitStatus;
  image: string | null;
  imageExpiration: string | null;
  organizationId: string;
  createdById: string;
  categoryId: string | null;
  locationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TeamMemberRow = {
  id: string;
  name: string;
  organizationId: string;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type CustodyRow = {
  id: string;
  teamMemberId: string;
  assetId: string;
  createdAt: string;
  updatedAt: string;
};

export type KitCustodyRow = {
  id: string;
  custodianId: string;
  kitId: string;
  createdAt: string;
  updatedAt: string;
};

export type AssetFilterPresetRow = {
  id: string;
  organizationId: string;
  ownerId: string;
  name: string;
  query: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AssetIndexSettingsRow = {
  id: string;
  userId: string;
  organizationId: string;
  mode: AssetIndexMode;
  columns: unknown; // jsonb
  freezeColumn: boolean;
  showAssetImage: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AssetReminderRow = {
  id: string;
  name: string;
  message: string;
  alertDateTime: string;
  activeSchedulerReference: string | null;
  organizationId: string;
  assetId: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type PrintBatchRow = {
  id: string;
  name: string;
  printed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type QrRow = {
  id: string;
  version: number;
  errorCorrection: ErrorCorrection;
  assetId: string | null;
  kitId: string | null;
  userId: string | null;
  organizationId: string | null;
  batchId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BarcodeRow = {
  id: string;
  value: string;
  type: BarcodeType;
  assetId: string | null;
  kitId: string | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
};

export type ScanRow = {
  id: string;
  latitude: string | null;
  longitude: string | null;
  userAgent: string | null;
  userId: string | null;
  qrId: string | null;
  rawQrId: string;
  manuallyGenerated: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NoteRow = {
  id: string;
  content: string;
  type: NoteType;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  assetId: string;
};

export type LocationNoteRow = {
  id: string;
  content: string;
  type: NoteType;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  locationId: string;
};

export type ReportFoundRow = {
  id: string;
  email: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  assetId: string | null;
  kitId: string | null;
};

export type InviteRow = {
  id: string;
  inviterId: string;
  organizationId: string;
  inviteeUserId: string | null;
  teamMemberId: string;
  inviteeEmail: string;
  status: InviteStatuses;
  inviteCode: string;
  roles: OrganizationRoles[];
  inviteMessage: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type BookingRow = {
  id: string;
  name: string;
  status: BookingStatus;
  description: string | null;
  activeSchedulerReference: string | null;
  creatorId: string;
  custodianUserId: string | null;
  custodianTeamMemberId: string | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  from: string;
  to: string;
  originalFrom: string | null;
  originalTo: string | null;
  autoArchivedAt: string | null;
  cancellationReason: string | null;
};

export type BookingNoteRow = {
  id: string;
  content: string;
  type: NoteType;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  bookingId: string;
};

export type BookingSettingsRow = {
  id: string;
  bufferStartTime: number;
  tagsRequired: boolean;
  maxBookingLength: number | null;
  maxBookingLengthSkipClosedDays: boolean;
  autoArchiveBookings: boolean;
  autoArchiveDays: number;
  requireExplicitCheckinForAdmin: boolean;
  requireExplicitCheckinForSelfService: boolean;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
};

export type PartialBookingCheckinRow = {
  id: string;
  assetIds: string[];
  checkinCount: number;
  checkinTimestamp: string;
  bookingId: string;
  checkedInById: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkingHoursRow = {
  id: string;
  enabled: boolean;
  weeklySchedule: unknown; // jsonb
  organizationId: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkingHoursOverrideRow = {
  id: string;
  date: string;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  reason: string | null;
  workingHoursId: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomFieldRow = {
  id: string;
  name: string;
  helpText: string | null;
  required: boolean;
  active: boolean;
  type: CustomFieldType;
  options: string[];
  organizationId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type AssetCustomFieldValueRow = {
  id: string;
  value: unknown; // jsonb
  assetId: string;
  customFieldId: string;
  createdAt: string;
  updatedAt: string;
};

export type AuditSessionRow = {
  id: string;
  name: string;
  description: string | null;
  targetId: string | null;
  status: AuditStatus;
  scopeMeta: unknown | null; // jsonb
  expectedAssetCount: number;
  foundAssetCount: number;
  missingAssetCount: number;
  unexpectedAssetCount: number;
  startedAt: string | null;
  dueDate: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  activeSchedulerReference: string | null;
  createdById: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
};

export type AuditAssignmentRow = {
  id: string;
  auditSessionId: string;
  userId: string;
  role: AuditAssignmentRole | null;
  createdAt: string;
  updatedAt: string;
};

export type AuditAssetRow = {
  id: string;
  auditSessionId: string;
  assetId: string;
  expected: boolean;
  status: AuditAssetStatus;
  scannedById: string | null;
  scannedAt: string | null;
  metadata: unknown | null; // jsonb
  createdAt: string;
  updatedAt: string;
};

export type AuditScanRow = {
  id: string;
  auditSessionId: string;
  auditAssetId: string | null;
  assetId: string | null;
  scannedById: string | null;
  code: string | null;
  metadata: unknown | null; // jsonb
  scannedAt: string;
  createdAt: string;
};

export type AuditNoteRow = {
  id: string;
  content: string;
  type: NoteType;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  auditSessionId: string;
  auditAssetId: string | null;
};

export type AuditImageRow = {
  id: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  description: string | null;
  auditSessionId: string;
  auditAssetId: string | null;
  uploadedById: string | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
};

export type AnnouncementRow = {
  id: string;
  name: string;
  content: string;
  link: string | null;
  linkText: string | null;
  published: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpdateRow = {
  id: string;
  title: string;
  content: string;
  url: string | null;
  imageUrl: string | null;
  publishDate: string;
  status: UpdateStatus;
  targetRoles: OrganizationRoles[];
  clickCount: number;
  viewCount: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type UserUpdateReadRow = {
  id: string;
  userId: string;
  updateId: string;
  readAt: string;
};

export type RoleChangeLogRow = {
  id: string;
  previousRole: OrganizationRoles;
  newRole: OrganizationRoles;
  createdAt: string;
  userId: string;
  changedById: string;
  organizationId: string;
};

// ---------------------------------------------------------------------------
// Insert types  (what you pass to an INSERT — omits server-defaulted fields)
// ---------------------------------------------------------------------------

/**
 * Flattens intersection types (`A & B`) into a single mapped object type.
 * Required so Supabase's type system can verify Insert types extend
 * `Record<string, unknown>` (TypeScript can't prove that for raw `&` types).
 */
type Flatten<T> = { [K in keyof T]: T[K] };

export type TierLimitInsert = Flatten<
  Partial<Omit<TierLimitRow, "id">> & Pick<TierLimitRow, "id">
>;

export type TierInsert = Flatten<
  Partial<Omit<TierRow, "id" | "name">> & Pick<TierRow, "id" | "name">
>;

export type RoleInsert = Partial<RoleRow>;

export type SsoDetailsInsert = Flatten<
  Partial<Omit<SsoDetailsRow, "domain">> & Pick<SsoDetailsRow, "domain">
>;

export type UserInsert = Flatten<
  Partial<Omit<UserRow, "email">> & Pick<UserRow, "email">
>;

export type ImageInsert = Flatten<
  Partial<Omit<ImageRow, "contentType" | "blob" | "ownerOrgId" | "userId">> &
    Pick<ImageRow, "contentType" | "blob" | "ownerOrgId" | "userId">
>;

export type OrganizationInsert = Flatten<
  Partial<Omit<OrganizationRow, "userId">> & Pick<OrganizationRow, "userId">
>;

export type UserContactInsert = Flatten<
  Partial<Omit<UserContactRow, "userId">> & Pick<UserContactRow, "userId">
>;

export type UserBusinessIntelInsert = Flatten<
  Partial<Omit<UserBusinessIntelRow, "userId">> &
    Pick<UserBusinessIntelRow, "userId">
>;

export type CustomTierLimitInsert = Partial<CustomTierLimitRow>;

export type UserOrganizationInsert = Flatten<
  Partial<Omit<UserOrganizationRow, "userId" | "organizationId">> &
    Pick<UserOrganizationRow, "userId" | "organizationId">
>;

export type LocationInsert = Flatten<
  Partial<Omit<LocationRow, "name" | "userId" | "organizationId">> &
    Pick<LocationRow, "name" | "userId" | "organizationId">
>;

export type CategoryInsert = Flatten<
  Partial<Omit<CategoryRow, "name" | "color" | "userId" | "organizationId">> &
    Pick<CategoryRow, "name" | "color" | "userId" | "organizationId">
>;

export type TagInsert = Flatten<
  Partial<Omit<TagRow, "name" | "userId" | "organizationId">> &
    Pick<TagRow, "name" | "userId" | "organizationId">
>;

export type AssetInsert = Flatten<
  Partial<Omit<AssetRow, "title" | "userId" | "organizationId">> &
    Pick<AssetRow, "title" | "userId" | "organizationId">
>;

export type KitInsert = Flatten<
  Partial<Omit<KitRow, "name" | "organizationId" | "createdById">> &
    Pick<KitRow, "name" | "organizationId" | "createdById">
>;

export type TeamMemberInsert = Flatten<
  Partial<Omit<TeamMemberRow, "name" | "organizationId">> &
    Pick<TeamMemberRow, "name" | "organizationId">
>;

export type CustodyInsert = Flatten<
  Partial<Omit<CustodyRow, "teamMemberId" | "assetId">> &
    Pick<CustodyRow, "teamMemberId" | "assetId">
>;

export type KitCustodyInsert = Flatten<
  Partial<Omit<KitCustodyRow, "custodianId" | "kitId">> &
    Pick<KitCustodyRow, "custodianId" | "kitId">
>;

export type AssetFilterPresetInsert = Flatten<
  Partial<
    Omit<AssetFilterPresetRow, "organizationId" | "ownerId" | "name" | "query">
  > &
    Pick<AssetFilterPresetRow, "organizationId" | "ownerId" | "name" | "query">
>;

export type AssetIndexSettingsInsert = Flatten<
  Partial<Omit<AssetIndexSettingsRow, "userId" | "organizationId">> &
    Pick<AssetIndexSettingsRow, "userId" | "organizationId">
>;

export type AssetReminderInsert = Flatten<
  Partial<
    Omit<
      AssetReminderRow,
      | "name"
      | "message"
      | "alertDateTime"
      | "organizationId"
      | "assetId"
      | "createdById"
    >
  > &
    Pick<
      AssetReminderRow,
      | "name"
      | "message"
      | "alertDateTime"
      | "organizationId"
      | "assetId"
      | "createdById"
    >
>;

export type PrintBatchInsert = Flatten<
  Partial<Omit<PrintBatchRow, "name">> & Pick<PrintBatchRow, "name">
>;

export type QrInsert = Partial<QrRow>;

export type BarcodeInsert = Flatten<
  Partial<Omit<BarcodeRow, "value" | "organizationId">> &
    Pick<BarcodeRow, "value" | "organizationId">
>;

export type ScanInsert = Flatten<
  Partial<Omit<ScanRow, "rawQrId">> & Pick<ScanRow, "rawQrId">
>;

export type NoteInsert = Flatten<
  Partial<Omit<NoteRow, "content" | "assetId">> &
    Pick<NoteRow, "content" | "assetId">
>;

export type LocationNoteInsert = Flatten<
  Partial<Omit<LocationNoteRow, "content" | "locationId">> &
    Pick<LocationNoteRow, "content" | "locationId">
>;

export type ReportFoundInsert = Flatten<
  Partial<Omit<ReportFoundRow, "email" | "content">> &
    Pick<ReportFoundRow, "email" | "content">
>;

export type InviteInsert = Flatten<
  Partial<
    Omit<
      InviteRow,
      | "inviterId"
      | "organizationId"
      | "teamMemberId"
      | "inviteeEmail"
      | "inviteCode"
      | "expiresAt"
    >
  > &
    Pick<
      InviteRow,
      | "inviterId"
      | "organizationId"
      | "teamMemberId"
      | "inviteeEmail"
      | "inviteCode"
      | "expiresAt"
    >
>;

export type BookingInsert = Flatten<
  Partial<
    Omit<BookingRow, "name" | "creatorId" | "organizationId" | "from" | "to">
  > &
    Pick<BookingRow, "name" | "creatorId" | "organizationId" | "from" | "to">
>;

export type BookingNoteInsert = Flatten<
  Partial<Omit<BookingNoteRow, "content" | "bookingId">> &
    Pick<BookingNoteRow, "content" | "bookingId">
>;

export type BookingSettingsInsert = Flatten<
  Partial<Omit<BookingSettingsRow, "organizationId">> &
    Pick<BookingSettingsRow, "organizationId">
>;

export type PartialBookingCheckinInsert = Flatten<
  Partial<
    Omit<
      PartialBookingCheckinRow,
      "checkinCount" | "bookingId" | "checkedInById"
    >
  > &
    Pick<
      PartialBookingCheckinRow,
      "checkinCount" | "bookingId" | "checkedInById"
    >
>;

export type WorkingHoursInsert = Flatten<
  Partial<Omit<WorkingHoursRow, "organizationId">> &
    Pick<WorkingHoursRow, "organizationId">
>;

export type WorkingHoursOverrideInsert = Flatten<
  Partial<Omit<WorkingHoursOverrideRow, "date" | "workingHoursId">> &
    Pick<WorkingHoursOverrideRow, "date" | "workingHoursId">
>;

export type CustomFieldInsert = Flatten<
  Partial<Omit<CustomFieldRow, "name" | "organizationId" | "userId">> &
    Pick<CustomFieldRow, "name" | "organizationId" | "userId">
>;

export type AssetCustomFieldValueInsert = Flatten<
  Partial<
    Omit<AssetCustomFieldValueRow, "value" | "assetId" | "customFieldId">
  > &
    Pick<AssetCustomFieldValueRow, "value" | "assetId" | "customFieldId">
>;

export type AuditSessionInsert = Flatten<
  Partial<Omit<AuditSessionRow, "name" | "createdById" | "organizationId">> &
    Pick<AuditSessionRow, "name" | "createdById" | "organizationId">
>;

export type AuditAssignmentInsert = Flatten<
  Partial<Omit<AuditAssignmentRow, "auditSessionId" | "userId">> &
    Pick<AuditAssignmentRow, "auditSessionId" | "userId">
>;

export type AuditAssetInsert = Flatten<
  Partial<Omit<AuditAssetRow, "auditSessionId" | "assetId">> &
    Pick<AuditAssetRow, "auditSessionId" | "assetId">
>;

export type AuditScanInsert = Flatten<
  Partial<Omit<AuditScanRow, "auditSessionId">> &
    Pick<AuditScanRow, "auditSessionId">
>;

export type AuditNoteInsert = Flatten<
  Partial<Omit<AuditNoteRow, "content" | "auditSessionId">> &
    Pick<AuditNoteRow, "content" | "auditSessionId">
>;

export type AuditImageInsert = Flatten<
  Partial<
    Omit<AuditImageRow, "imageUrl" | "auditSessionId" | "organizationId">
  > &
    Pick<AuditImageRow, "imageUrl" | "auditSessionId" | "organizationId">
>;

export type AnnouncementInsert = Flatten<
  Partial<Omit<AnnouncementRow, "name" | "content">> &
    Pick<AnnouncementRow, "name" | "content">
>;

export type UpdateInsert = Flatten<
  Partial<
    Omit<UpdateRow, "title" | "content" | "publishDate" | "createdById">
  > &
    Pick<UpdateRow, "title" | "content" | "publishDate" | "createdById">
>;

export type UserUpdateReadInsert = Flatten<
  Partial<Omit<UserUpdateReadRow, "userId" | "updateId">> &
    Pick<UserUpdateReadRow, "userId" | "updateId">
>;

export type RoleChangeLogInsert = Flatten<
  Partial<
    Omit<
      RoleChangeLogRow,
      "previousRole" | "newRole" | "userId" | "changedById" | "organizationId"
    >
  > &
    Pick<
      RoleChangeLogRow,
      "previousRole" | "newRole" | "userId" | "changedById" | "organizationId"
    >
>;

// ---------------------------------------------------------------------------
// Update types  (all fields optional except id is used as filter)
// ---------------------------------------------------------------------------

export type TierLimitUpdate = Partial<TierLimitRow>;
export type TierUpdate = Partial<TierRow>;
export type RoleUpdate = Partial<RoleRow>;
export type SsoDetailsUpdate = Partial<SsoDetailsRow>;
export type UserUpdate = Partial<UserRow>;
export type ImageUpdate = Partial<ImageRow>;
export type OrganizationUpdate = Partial<OrganizationRow>;
export type UserContactUpdate = Partial<UserContactRow>;
export type UserBusinessIntelUpdate = Partial<UserBusinessIntelRow>;
export type CustomTierLimitUpdate = Partial<CustomTierLimitRow>;
export type UserOrganizationUpdate = Partial<UserOrganizationRow>;
export type LocationUpdate = Partial<LocationRow>;
export type CategoryUpdate = Partial<CategoryRow>;
export type TagUpdate = Partial<TagRow>;
export type AssetUpdate = Partial<AssetRow>;
export type KitUpdate = Partial<KitRow>;
export type TeamMemberUpdate = Partial<TeamMemberRow>;
export type CustodyUpdate = Partial<CustodyRow>;
export type KitCustodyUpdate = Partial<KitCustodyRow>;
export type AssetFilterPresetUpdate = Partial<AssetFilterPresetRow>;
export type AssetIndexSettingsUpdate = Partial<AssetIndexSettingsRow>;
export type AssetReminderUpdate = Partial<AssetReminderRow>;
export type PrintBatchUpdate = Partial<PrintBatchRow>;
export type QrUpdate = Partial<QrRow>;
export type BarcodeUpdate = Partial<BarcodeRow>;
export type ScanUpdate = Partial<ScanRow>;
export type NoteUpdate = Partial<NoteRow>;
export type LocationNoteUpdate = Partial<LocationNoteRow>;
export type ReportFoundUpdate = Partial<ReportFoundRow>;
export type InviteUpdate = Partial<InviteRow>;
export type BookingUpdate = Partial<BookingRow>;
export type BookingNoteUpdate = Partial<BookingNoteRow>;
export type BookingSettingsUpdate = Partial<BookingSettingsRow>;
export type PartialBookingCheckinUpdate = Partial<PartialBookingCheckinRow>;
export type WorkingHoursUpdate = Partial<WorkingHoursRow>;
export type WorkingHoursOverrideUpdate = Partial<WorkingHoursOverrideRow>;
export type CustomFieldUpdate = Partial<CustomFieldRow>;
export type AssetCustomFieldValueUpdate = Partial<AssetCustomFieldValueRow>;
export type AuditSessionUpdate = Partial<AuditSessionRow>;
export type AuditAssignmentUpdate = Partial<AuditAssignmentRow>;
export type AuditAssetUpdate = Partial<AuditAssetRow>;
export type AuditScanUpdate = Partial<AuditScanRow>;
export type AuditNoteUpdate = Partial<AuditNoteRow>;
export type AuditImageUpdate = Partial<AuditImageRow>;
export type AnnouncementUpdate = Partial<AnnouncementRow>;
export type UpdateUpdate = Partial<UpdateRow>;
export type UserUpdateReadUpdate = Partial<UserUpdateReadRow>;
export type RoleChangeLogUpdate = Partial<RoleChangeLogRow>;

// ---------------------------------------------------------------------------
// Supabase-compatible Database type definition
// ---------------------------------------------------------------------------

export type Database = {
  public: {
    Tables: {
      TierLimit: {
        Row: TierLimitRow;
        Insert: TierLimitInsert;
        Update: TierLimitUpdate;
        Relationships: [];
      };
      Tier: {
        Row: TierRow;
        Insert: TierInsert;
        Update: TierUpdate;
        Relationships: [];
      };
      Role: {
        Row: RoleRow;
        Insert: RoleInsert;
        Update: RoleUpdate;
        Relationships: [];
      };
      SsoDetails: {
        Row: SsoDetailsRow;
        Insert: SsoDetailsInsert;
        Update: SsoDetailsUpdate;
        Relationships: [];
      };
      User: {
        Row: UserRow;
        Insert: UserInsert;
        Update: UserUpdate;
        Relationships: [];
      };
      Image: {
        Row: ImageRow;
        Insert: ImageInsert;
        Update: ImageUpdate;
        Relationships: [];
      };
      Organization: {
        Row: OrganizationRow;
        Insert: OrganizationInsert;
        Update: OrganizationUpdate;
        Relationships: [];
      };
      UserContact: {
        Row: UserContactRow;
        Insert: UserContactInsert;
        Update: UserContactUpdate;
        Relationships: [];
      };
      UserBusinessIntel: {
        Row: UserBusinessIntelRow;
        Insert: UserBusinessIntelInsert;
        Update: UserBusinessIntelUpdate;
        Relationships: [];
      };
      CustomTierLimit: {
        Row: CustomTierLimitRow;
        Insert: CustomTierLimitInsert;
        Update: CustomTierLimitUpdate;
        Relationships: [];
      };
      UserOrganization: {
        Row: UserOrganizationRow;
        Insert: UserOrganizationInsert;
        Update: UserOrganizationUpdate;
        Relationships: [];
      };
      Location: {
        Row: LocationRow;
        Insert: LocationInsert;
        Update: LocationUpdate;
        Relationships: [];
      };
      Category: {
        Row: CategoryRow;
        Insert: CategoryInsert;
        Update: CategoryUpdate;
        Relationships: [];
      };
      Tag: {
        Row: TagRow;
        Insert: TagInsert;
        Update: TagUpdate;
        Relationships: [];
      };
      Asset: {
        Row: AssetRow;
        Insert: AssetInsert;
        Update: AssetUpdate;
        Relationships: [];
      };
      Kit: {
        Row: KitRow;
        Insert: KitInsert;
        Update: KitUpdate;
        Relationships: [];
      };
      TeamMember: {
        Row: TeamMemberRow;
        Insert: TeamMemberInsert;
        Update: TeamMemberUpdate;
        Relationships: [];
      };
      Custody: {
        Row: CustodyRow;
        Insert: CustodyInsert;
        Update: CustodyUpdate;
        Relationships: [];
      };
      KitCustody: {
        Row: KitCustodyRow;
        Insert: KitCustodyInsert;
        Update: KitCustodyUpdate;
        Relationships: [];
      };
      _AssetToTag: {
        Row: { A: string; B: string };
        Insert: { A: string; B: string };
        Update: Partial<{ A: string; B: string }>;
        Relationships: [];
      };
      AssetFilterPreset: {
        Row: AssetFilterPresetRow;
        Insert: AssetFilterPresetInsert;
        Update: AssetFilterPresetUpdate;
        Relationships: [];
      };
      AssetIndexSettings: {
        Row: AssetIndexSettingsRow;
        Insert: AssetIndexSettingsInsert;
        Update: AssetIndexSettingsUpdate;
        Relationships: [];
      };
      AssetReminder: {
        Row: AssetReminderRow;
        Insert: AssetReminderInsert;
        Update: AssetReminderUpdate;
        Relationships: [];
      };
      _AssetReminderToTeamMember: {
        Row: { A: string; B: string };
        Insert: { A: string; B: string };
        Update: Partial<{ A: string; B: string }>;
        Relationships: [];
      };
      PrintBatch: {
        Row: PrintBatchRow;
        Insert: PrintBatchInsert;
        Update: PrintBatchUpdate;
        Relationships: [];
      };
      Qr: {
        Row: QrRow;
        Insert: QrInsert;
        Update: QrUpdate;
        Relationships: [];
      };
      Barcode: {
        Row: BarcodeRow;
        Insert: BarcodeInsert;
        Update: BarcodeUpdate;
        Relationships: [];
      };
      Scan: {
        Row: ScanRow;
        Insert: ScanInsert;
        Update: ScanUpdate;
        Relationships: [];
      };
      Note: {
        Row: NoteRow;
        Insert: NoteInsert;
        Update: NoteUpdate;
        Relationships: [];
      };
      LocationNote: {
        Row: LocationNoteRow;
        Insert: LocationNoteInsert;
        Update: LocationNoteUpdate;
        Relationships: [];
      };
      ReportFound: {
        Row: ReportFoundRow;
        Insert: ReportFoundInsert;
        Update: ReportFoundUpdate;
        Relationships: [];
      };
      Invite: {
        Row: InviteRow;
        Insert: InviteInsert;
        Update: InviteUpdate;
        Relationships: [];
      };
      Booking: {
        Row: BookingRow;
        Insert: BookingInsert;
        Update: BookingUpdate;
        Relationships: [];
      };
      _AssetToBooking: {
        Row: { A: string; B: string };
        Insert: { A: string; B: string };
        Update: Partial<{ A: string; B: string }>;
        Relationships: [];
      };
      _BookingToTag: {
        Row: { A: string; B: string };
        Insert: { A: string; B: string };
        Update: Partial<{ A: string; B: string }>;
        Relationships: [];
      };
      BookingNote: {
        Row: BookingNoteRow;
        Insert: BookingNoteInsert;
        Update: BookingNoteUpdate;
        Relationships: [];
      };
      BookingSettings: {
        Row: BookingSettingsRow;
        Insert: BookingSettingsInsert;
        Update: BookingSettingsUpdate;
        Relationships: [];
      };
      PartialBookingCheckin: {
        Row: PartialBookingCheckinRow;
        Insert: PartialBookingCheckinInsert;
        Update: PartialBookingCheckinUpdate;
        Relationships: [];
      };
      WorkingHours: {
        Row: WorkingHoursRow;
        Insert: WorkingHoursInsert;
        Update: WorkingHoursUpdate;
        Relationships: [];
      };
      WorkingHoursOverride: {
        Row: WorkingHoursOverrideRow;
        Insert: WorkingHoursOverrideInsert;
        Update: WorkingHoursOverrideUpdate;
        Relationships: [];
      };
      CustomField: {
        Row: CustomFieldRow;
        Insert: CustomFieldInsert;
        Update: CustomFieldUpdate;
        Relationships: [];
      };
      AssetCustomFieldValue: {
        Row: AssetCustomFieldValueRow;
        Insert: AssetCustomFieldValueInsert;
        Update: AssetCustomFieldValueUpdate;
        Relationships: [];
      };
      _CategoryToCustomField: {
        Row: { A: string; B: string };
        Insert: { A: string; B: string };
        Update: Partial<{ A: string; B: string }>;
        Relationships: [];
      };
      AuditSession: {
        Row: AuditSessionRow;
        Insert: AuditSessionInsert;
        Update: AuditSessionUpdate;
        Relationships: [];
      };
      AuditAssignment: {
        Row: AuditAssignmentRow;
        Insert: AuditAssignmentInsert;
        Update: AuditAssignmentUpdate;
        Relationships: [];
      };
      AuditAsset: {
        Row: AuditAssetRow;
        Insert: AuditAssetInsert;
        Update: AuditAssetUpdate;
        Relationships: [];
      };
      AuditScan: {
        Row: AuditScanRow;
        Insert: AuditScanInsert;
        Update: AuditScanUpdate;
        Relationships: [];
      };
      AuditNote: {
        Row: AuditNoteRow;
        Insert: AuditNoteInsert;
        Update: AuditNoteUpdate;
        Relationships: [];
      };
      AuditImage: {
        Row: AuditImageRow;
        Insert: AuditImageInsert;
        Update: AuditImageUpdate;
        Relationships: [];
      };
      Announcement: {
        Row: AnnouncementRow;
        Insert: AnnouncementInsert;
        Update: AnnouncementUpdate;
        Relationships: [];
      };
      Update: {
        Row: UpdateRow;
        Insert: UpdateInsert;
        Update: UpdateUpdate;
        Relationships: [];
      };
      UserUpdateRead: {
        Row: UserUpdateReadRow;
        Insert: UserUpdateReadInsert;
        Update: UserUpdateReadUpdate;
        Relationships: [];
      };
      _RoleToUser: {
        Row: { A: string; B: string };
        Insert: { A: string; B: string };
        Update: Partial<{ A: string; B: string }>;
        Relationships: [];
      };
      RoleChangeLog: {
        Row: RoleChangeLogRow;
        Insert: RoleChangeLogInsert;
        Update: RoleChangeLogUpdate;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_asset_sequence_for_org: {
        Args: { org_id: string };
        Returns: undefined;
      };
      get_next_sequential_id: {
        Args: { org_id: string; prefix?: string };
        Returns: string;
      };
      reset_asset_sequence_for_org: {
        Args: { org_id: string };
        Returns: undefined;
      };
      get_current_sequence_value: {
        Args: { org_id: string };
        Returns: number | null;
      };
      get_max_sequential_id_number: {
        Args: { org_id: string; prefix?: string };
        Returns: number;
      };
      get_assets_without_sequential_id: {
        Args: { org_id: string };
        Returns: { id: string }[];
      };
      batch_update_sequential_ids: {
        Args: { asset_ids: string[]; sequential_ids: string[] };
        Returns: number;
      };
      set_asset_sequence_value: {
        Args: { org_id: string; new_value: number };
        Returns: undefined;
      };
      generate_bulk_sequential_ids: {
        Args: { org_id: string; prefix?: string };
        Returns: number;
      };
      estimate_next_sequential_id: {
        Args: { org_id: string; prefix?: string };
        Returns: string;
      };
      get_location_hierarchy: {
        Args: { location_id: string; organization_id: string };
        Returns: {
          id: string;
          name: string;
          parentId: string | null;
          depth: number;
        }[];
      };
      get_location_descendants: {
        Args: { location_id: string; organization_id: string };
        Returns: {
          id: string;
          name: string;
          parentId: string | null;
        }[];
      };
      get_location_descendant_ids: {
        Args: { location_id: string; organization_id: string };
        Returns: { id: string; parentId: string | null }[];
      };
      get_location_subtree_depth: {
        Args: { location_id: string; organization_id: string };
        Returns: number;
      };
      find_auth_user_by_email: {
        Args: { user_email: string };
        Returns: { id: string }[];
      };
      validate_refresh_token: {
        Args: { refresh_token: string };
        Returns: { id: string; revoked: boolean }[];
      };
      get_custom_field_usage_counts: {
        Args: { organization_id: string };
        Returns: { customFieldId: string; count: number }[];
      };
      clear_user_last_selected_org: {
        Args: { user_id: string; organization_id: string };
        Returns: undefined;
      };
      remove_custom_field_from_asset_index: {
        Args: { column_name: string; organization_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      AssetStatus: AssetStatus;
      AssetIndexMode: AssetIndexMode;
      NoteType: NoteType;
      ErrorCorrection: ErrorCorrection;
      BarcodeType: BarcodeType;
      TagUseFor: TagUseFor;
      Roles: Roles;
      OrganizationType: OrganizationType;
      QrIdDisplayPreference: QrIdDisplayPreference;
      OrganizationRoles: OrganizationRoles;
      InviteStatuses: InviteStatuses;
      BookingStatus: BookingStatus;
      KitStatus: KitStatus;
      TierId: TierId;
      CustomFieldType: CustomFieldType;
      UpdateStatus: UpdateStatus;
      AuditStatus: AuditStatus;
      AuditAssetStatus: AuditAssetStatus;
      AuditAssignmentRole: AuditAssignmentRole;
      Currency: Currency;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
