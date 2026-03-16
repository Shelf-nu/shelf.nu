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

export interface TierLimitRow {
  id: TierId;
  canImportAssets: boolean;
  canExportAssets: boolean;
  canImportNRM: boolean;
  canHideShelfBranding: boolean;
  maxCustomFields: number;
  maxOrganizations: number;
  createdAt: string;
  updatedAt: string;
}

export interface TierRow {
  id: TierId;
  name: string;
  tierLimitId: TierId | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleRow {
  id: string;
  name: Roles;
  createdAt: string;
  updatedAt: string;
}

export interface SsoDetailsRow {
  id: string;
  domain: string;
  baseUserGroupId: string | null;
  selfServiceGroupId: string | null;
  adminGroupId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserRow {
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
}

export interface ImageRow {
  id: string;
  contentType: string;
  altText: string | null;
  blob: string; // bytea comes as base64 string from PostgREST
  createdAt: string;
  updatedAt: string;
  ownerOrgId: string;
  userId: string;
}

export interface OrganizationRow {
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
}

export interface UserContactRow {
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
}

export interface UserBusinessIntelRow {
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
}

export interface CustomTierLimitRow {
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
}

export interface UserOrganizationRow {
  id: string;
  userId: string;
  organizationId: string;
  roles: OrganizationRoles[];
  createdAt: string;
  updatedAt: string;
}

export interface LocationRow {
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
}

export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  organizationId: string;
}

export interface TagRow {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  useFor: TagUseFor[];
  userId: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssetRow {
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
}

export interface KitRow {
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
}

export interface TeamMemberRow {
  id: string;
  name: string;
  organizationId: string;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CustodyRow {
  id: string;
  teamMemberId: string;
  assetId: string;
  createdAt: string;
  updatedAt: string;
}

export interface KitCustodyRow {
  id: string;
  custodianId: string;
  kitId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssetFilterPresetRow {
  id: string;
  organizationId: string;
  ownerId: string;
  name: string;
  query: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AssetIndexSettingsRow {
  id: string;
  userId: string;
  organizationId: string;
  mode: AssetIndexMode;
  columns: unknown; // jsonb
  freezeColumn: boolean;
  showAssetImage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AssetReminderRow {
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
}

export interface PrintBatchRow {
  id: string;
  name: string;
  printed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QrRow {
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
}

export interface BarcodeRow {
  id: string;
  value: string;
  type: BarcodeType;
  assetId: string | null;
  kitId: string | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScanRow {
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
}

export interface NoteRow {
  id: string;
  content: string;
  type: NoteType;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  assetId: string;
}

export interface LocationNoteRow {
  id: string;
  content: string;
  type: NoteType;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  locationId: string;
}

export interface ReportFoundRow {
  id: string;
  email: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  assetId: string | null;
  kitId: string | null;
}

export interface InviteRow {
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
}

export interface BookingRow {
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
}

export interface BookingNoteRow {
  id: string;
  content: string;
  type: NoteType;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  bookingId: string;
}

export interface BookingSettingsRow {
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
}

export interface PartialBookingCheckinRow {
  id: string;
  assetIds: string[];
  checkinCount: number;
  checkinTimestamp: string;
  bookingId: string;
  checkedInById: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkingHoursRow {
  id: string;
  enabled: boolean;
  weeklySchedule: unknown; // jsonb
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkingHoursOverrideRow {
  id: string;
  date: string;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  reason: string | null;
  workingHoursId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomFieldRow {
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
}

export interface AssetCustomFieldValueRow {
  id: string;
  value: unknown; // jsonb
  assetId: string;
  customFieldId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditSessionRow {
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
}

export interface AuditAssignmentRow {
  id: string;
  auditSessionId: string;
  userId: string;
  role: AuditAssignmentRole | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditAssetRow {
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
}

export interface AuditScanRow {
  id: string;
  auditSessionId: string;
  auditAssetId: string | null;
  assetId: string | null;
  scannedById: string | null;
  code: string | null;
  metadata: unknown | null; // jsonb
  scannedAt: string;
  createdAt: string;
}

export interface AuditNoteRow {
  id: string;
  content: string;
  type: NoteType;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  auditSessionId: string;
  auditAssetId: string | null;
}

export interface AuditImageRow {
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
}

export interface AnnouncementRow {
  id: string;
  name: string;
  content: string;
  link: string | null;
  linkText: string | null;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateRow {
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
}

export interface UserUpdateReadRow {
  id: string;
  userId: string;
  updateId: string;
  readAt: string;
}

export interface RoleChangeLogRow {
  id: string;
  previousRole: OrganizationRoles;
  newRole: OrganizationRoles;
  createdAt: string;
  userId: string;
  changedById: string;
  organizationId: string;
}

// ---------------------------------------------------------------------------
// Insert types  (what you pass to an INSERT — omits server-defaulted fields)
// ---------------------------------------------------------------------------

export type TierLimitInsert = Partial<Omit<TierLimitRow, "id">> &
  Pick<TierLimitRow, "id">;

export type TierInsert = Partial<Omit<TierRow, "id" | "name">> &
  Pick<TierRow, "id" | "name">;

export type RoleInsert = Partial<RoleRow>;

export type SsoDetailsInsert = Partial<Omit<SsoDetailsRow, "domain">> &
  Pick<SsoDetailsRow, "domain">;

export type UserInsert = Partial<Omit<UserRow, "email">> &
  Pick<UserRow, "email">;

export type ImageInsert = Partial<
  Omit<ImageRow, "contentType" | "blob" | "ownerOrgId" | "userId">
> &
  Pick<ImageRow, "contentType" | "blob" | "ownerOrgId" | "userId">;

export type OrganizationInsert = Partial<Omit<OrganizationRow, "userId">> &
  Pick<OrganizationRow, "userId">;

export type UserContactInsert = Partial<Omit<UserContactRow, "userId">> &
  Pick<UserContactRow, "userId">;

export type UserBusinessIntelInsert = Partial<
  Omit<UserBusinessIntelRow, "userId">
> &
  Pick<UserBusinessIntelRow, "userId">;

export type CustomTierLimitInsert = Partial<CustomTierLimitRow>;

export type UserOrganizationInsert = Partial<
  Omit<UserOrganizationRow, "userId" | "organizationId">
> &
  Pick<UserOrganizationRow, "userId" | "organizationId">;

export type LocationInsert = Partial<
  Omit<LocationRow, "name" | "userId" | "organizationId">
> &
  Pick<LocationRow, "name" | "userId" | "organizationId">;

export type CategoryInsert = Partial<
  Omit<CategoryRow, "name" | "color" | "userId" | "organizationId">
> &
  Pick<CategoryRow, "name" | "color" | "userId" | "organizationId">;

export type TagInsert = Partial<
  Omit<TagRow, "name" | "userId" | "organizationId">
> &
  Pick<TagRow, "name" | "userId" | "organizationId">;

export type AssetInsert = Partial<
  Omit<AssetRow, "title" | "userId" | "organizationId">
> &
  Pick<AssetRow, "title" | "userId" | "organizationId">;

export type KitInsert = Partial<
  Omit<KitRow, "name" | "organizationId" | "createdById">
> &
  Pick<KitRow, "name" | "organizationId" | "createdById">;

export type TeamMemberInsert = Partial<
  Omit<TeamMemberRow, "name" | "organizationId">
> &
  Pick<TeamMemberRow, "name" | "organizationId">;

export type CustodyInsert = Partial<
  Omit<CustodyRow, "teamMemberId" | "assetId">
> &
  Pick<CustodyRow, "teamMemberId" | "assetId">;

export type KitCustodyInsert = Partial<
  Omit<KitCustodyRow, "custodianId" | "kitId">
> &
  Pick<KitCustodyRow, "custodianId" | "kitId">;

export type AssetFilterPresetInsert = Partial<
  Omit<AssetFilterPresetRow, "organizationId" | "ownerId" | "name" | "query">
> &
  Pick<AssetFilterPresetRow, "organizationId" | "ownerId" | "name" | "query">;

export type AssetIndexSettingsInsert = Partial<
  Omit<AssetIndexSettingsRow, "userId" | "organizationId">
> &
  Pick<AssetIndexSettingsRow, "userId" | "organizationId">;

export type AssetReminderInsert = Partial<
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
  >;

export type PrintBatchInsert = Partial<Omit<PrintBatchRow, "name">> &
  Pick<PrintBatchRow, "name">;

export type QrInsert = Partial<QrRow>;

export type BarcodeInsert = Partial<
  Omit<BarcodeRow, "value" | "organizationId">
> &
  Pick<BarcodeRow, "value" | "organizationId">;

export type ScanInsert = Partial<Omit<ScanRow, "rawQrId">> &
  Pick<ScanRow, "rawQrId">;

export type NoteInsert = Partial<Omit<NoteRow, "content" | "assetId">> &
  Pick<NoteRow, "content" | "assetId">;

export type LocationNoteInsert = Partial<
  Omit<LocationNoteRow, "content" | "locationId">
> &
  Pick<LocationNoteRow, "content" | "locationId">;

export type ReportFoundInsert = Partial<
  Omit<ReportFoundRow, "email" | "content">
> &
  Pick<ReportFoundRow, "email" | "content">;

export type InviteInsert = Partial<
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
  >;

export type BookingInsert = Partial<
  Omit<BookingRow, "name" | "creatorId" | "organizationId" | "from" | "to">
> &
  Pick<BookingRow, "name" | "creatorId" | "organizationId" | "from" | "to">;

export type BookingNoteInsert = Partial<
  Omit<BookingNoteRow, "content" | "bookingId">
> &
  Pick<BookingNoteRow, "content" | "bookingId">;

export type BookingSettingsInsert = Partial<
  Omit<BookingSettingsRow, "organizationId">
> &
  Pick<BookingSettingsRow, "organizationId">;

export type PartialBookingCheckinInsert = Partial<
  Omit<PartialBookingCheckinRow, "checkinCount" | "bookingId" | "checkedInById">
> &
  Pick<
    PartialBookingCheckinRow,
    "checkinCount" | "bookingId" | "checkedInById"
  >;

export type WorkingHoursInsert = Partial<
  Omit<WorkingHoursRow, "organizationId">
> &
  Pick<WorkingHoursRow, "organizationId">;

export type WorkingHoursOverrideInsert = Partial<
  Omit<WorkingHoursOverrideRow, "date" | "workingHoursId">
> &
  Pick<WorkingHoursOverrideRow, "date" | "workingHoursId">;

export type CustomFieldInsert = Partial<
  Omit<CustomFieldRow, "name" | "organizationId" | "userId">
> &
  Pick<CustomFieldRow, "name" | "organizationId" | "userId">;

export type AssetCustomFieldValueInsert = Partial<
  Omit<AssetCustomFieldValueRow, "value" | "assetId" | "customFieldId">
> &
  Pick<AssetCustomFieldValueRow, "value" | "assetId" | "customFieldId">;

export type AuditSessionInsert = Partial<
  Omit<AuditSessionRow, "name" | "createdById" | "organizationId">
> &
  Pick<AuditSessionRow, "name" | "createdById" | "organizationId">;

export type AuditAssignmentInsert = Partial<
  Omit<AuditAssignmentRow, "auditSessionId" | "userId">
> &
  Pick<AuditAssignmentRow, "auditSessionId" | "userId">;

export type AuditAssetInsert = Partial<
  Omit<AuditAssetRow, "auditSessionId" | "assetId">
> &
  Pick<AuditAssetRow, "auditSessionId" | "assetId">;

export type AuditScanInsert = Partial<Omit<AuditScanRow, "auditSessionId">> &
  Pick<AuditScanRow, "auditSessionId">;

export type AuditNoteInsert = Partial<
  Omit<AuditNoteRow, "content" | "auditSessionId">
> &
  Pick<AuditNoteRow, "content" | "auditSessionId">;

export type AuditImageInsert = Partial<
  Omit<AuditImageRow, "imageUrl" | "auditSessionId" | "organizationId">
> &
  Pick<AuditImageRow, "imageUrl" | "auditSessionId" | "organizationId">;

export type AnnouncementInsert = Partial<
  Omit<AnnouncementRow, "name" | "content">
> &
  Pick<AnnouncementRow, "name" | "content">;

export type UpdateInsert = Partial<
  Omit<UpdateRow, "title" | "content" | "publishDate" | "createdById">
> &
  Pick<UpdateRow, "title" | "content" | "publishDate" | "createdById">;

export type UserUpdateReadInsert = Partial<
  Omit<UserUpdateReadRow, "userId" | "updateId">
> &
  Pick<UserUpdateReadRow, "userId" | "updateId">;

export type RoleChangeLogInsert = Partial<
  Omit<
    RoleChangeLogRow,
    "previousRole" | "newRole" | "userId" | "changedById" | "organizationId"
  >
> &
  Pick<
    RoleChangeLogRow,
    "previousRole" | "newRole" | "userId" | "changedById" | "organizationId"
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

export interface Database {
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
      [_ in never]: never;
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
}
