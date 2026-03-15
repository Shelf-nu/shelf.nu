// =============================================================================
// Enum const objects + type unions
// Replaces Prisma-generated TypeScript enums with runtime-safe const objects
// that work as both values (AssetStatus.AVAILABLE) and types (AssetStatus)
// =============================================================================

export const AssetStatus = {
  AVAILABLE: "AVAILABLE",
  IN_CUSTODY: "IN_CUSTODY",
  CHECKED_OUT: "CHECKED_OUT",
} as const;
export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];

export const AssetIndexMode = {
  SIMPLE: "SIMPLE",
  ADVANCED: "ADVANCED",
} as const;
export type AssetIndexMode =
  (typeof AssetIndexMode)[keyof typeof AssetIndexMode];

export const TagUseFor = {
  ASSET: "ASSET",
  BOOKING: "BOOKING",
} as const;
export type TagUseFor = (typeof TagUseFor)[keyof typeof TagUseFor];

export const NoteType = {
  COMMENT: "COMMENT",
  UPDATE: "UPDATE",
} as const;
export type NoteType = (typeof NoteType)[keyof typeof NoteType];

export const ErrorCorrection = {
  L: "L",
  M: "M",
  Q: "Q",
  H: "H",
} as const;
export type ErrorCorrection =
  (typeof ErrorCorrection)[keyof typeof ErrorCorrection];

export const BarcodeType = {
  Code128: "Code128",
  Code39: "Code39",
  DataMatrix: "DataMatrix",
  ExternalQR: "ExternalQR",
  EAN13: "EAN13",
} as const;
export type BarcodeType = (typeof BarcodeType)[keyof typeof BarcodeType];

export const Roles = {
  USER: "USER",
  ADMIN: "ADMIN",
} as const;
export type Roles = (typeof Roles)[keyof typeof Roles];

export const OrganizationType = {
  PERSONAL: "PERSONAL",
  TEAM: "TEAM",
} as const;
export type OrganizationType =
  (typeof OrganizationType)[keyof typeof OrganizationType];

export const QrIdDisplayPreference = {
  QR_ID: "QR_ID",
  SAM_ID: "SAM_ID",
} as const;
export type QrIdDisplayPreference =
  (typeof QrIdDisplayPreference)[keyof typeof QrIdDisplayPreference];

export const OrganizationRoles = {
  ADMIN: "ADMIN",
  BASE: "BASE",
  OWNER: "OWNER",
  SELF_SERVICE: "SELF_SERVICE",
} as const;
export type OrganizationRoles =
  (typeof OrganizationRoles)[keyof typeof OrganizationRoles];

export const CustomFieldType = {
  TEXT: "TEXT",
  OPTION: "OPTION",
  BOOLEAN: "BOOLEAN",
  DATE: "DATE",
  MULTILINE_TEXT: "MULTILINE_TEXT",
  AMOUNT: "AMOUNT",
  NUMBER: "NUMBER",
} as const;
export type CustomFieldType =
  (typeof CustomFieldType)[keyof typeof CustomFieldType];

export const Currency = {
  AED: "AED",
  AFN: "AFN",
  ALL: "ALL",
  AMD: "AMD",
  ANG: "ANG",
  AOA: "AOA",
  ARS: "ARS",
  AUD: "AUD",
  AWG: "AWG",
  AZN: "AZN",
  BAM: "BAM",
  BBD: "BBD",
  BDT: "BDT",
  BGN: "BGN",
  BHD: "BHD",
  BIF: "BIF",
  BMD: "BMD",
  BND: "BND",
  BOB: "BOB",
  BRL: "BRL",
  BSD: "BSD",
  BTN: "BTN",
  BWP: "BWP",
  BYN: "BYN",
  BZD: "BZD",
  CAD: "CAD",
  CDF: "CDF",
  CHF: "CHF",
  CLP: "CLP",
  CNY: "CNY",
  COP: "COP",
  CRC: "CRC",
  CUP: "CUP",
  CVE: "CVE",
  CZK: "CZK",
  DJF: "DJF",
  DKK: "DKK",
  DOP: "DOP",
  DZD: "DZD",
  EGP: "EGP",
  ERN: "ERN",
  ETB: "ETB",
  EUR: "EUR",
  FJD: "FJD",
  FKP: "FKP",
  GBP: "GBP",
  GEL: "GEL",
  GHS: "GHS",
  GIP: "GIP",
  GMD: "GMD",
  GNF: "GNF",
  GTQ: "GTQ",
  GYD: "GYD",
  HKD: "HKD",
  HNL: "HNL",
  HTG: "HTG",
  HUF: "HUF",
  IDR: "IDR",
  ILS: "ILS",
  INR: "INR",
  IQD: "IQD",
  IRR: "IRR",
  ISK: "ISK",
  JMD: "JMD",
  JOD: "JOD",
  JPY: "JPY",
  KES: "KES",
  KGS: "KGS",
  KHR: "KHR",
  KMF: "KMF",
  KPW: "KPW",
  KRW: "KRW",
  KWD: "KWD",
  KYD: "KYD",
  KZT: "KZT",
  LAK: "LAK",
  LBP: "LBP",
  LKR: "LKR",
  LRD: "LRD",
  LSL: "LSL",
  LYD: "LYD",
  MAD: "MAD",
  MDL: "MDL",
  MGA: "MGA",
  MKD: "MKD",
  MMK: "MMK",
  MNT: "MNT",
  MOP: "MOP",
  MRU: "MRU",
  MUR: "MUR",
  MVR: "MVR",
  MWK: "MWK",
  MXN: "MXN",
  MYR: "MYR",
  MZN: "MZN",
  NAD: "NAD",
  NGN: "NGN",
  NIO: "NIO",
  NOK: "NOK",
  NPR: "NPR",
  NZD: "NZD",
  OMR: "OMR",
  PAB: "PAB",
  PEN: "PEN",
  PGK: "PGK",
  PHP: "PHP",
  PKR: "PKR",
  PLN: "PLN",
  PYG: "PYG",
  QAR: "QAR",
  RON: "RON",
  RSD: "RSD",
  RUB: "RUB",
  RWF: "RWF",
  SAR: "SAR",
  SBD: "SBD",
  SCR: "SCR",
  SDG: "SDG",
  SEK: "SEK",
  SGD: "SGD",
  SHP: "SHP",
  SLE: "SLE",
  SOS: "SOS",
  SRD: "SRD",
  SSP: "SSP",
  STN: "STN",
  SVC: "SVC",
  SYP: "SYP",
  SZL: "SZL",
  THB: "THB",
  TJS: "TJS",
  TMT: "TMT",
  TND: "TND",
  TOP: "TOP",
  TRY: "TRY",
  TTD: "TTD",
  TWD: "TWD",
  TZS: "TZS",
  UAH: "UAH",
  UGX: "UGX",
  USD: "USD",
  UYU: "UYU",
  UZS: "UZS",
  VES: "VES",
  VND: "VND",
  VUV: "VUV",
  WST: "WST",
  XAF: "XAF",
  XCD: "XCD",
  XOF: "XOF",
  XPF: "XPF",
  YER: "YER",
  ZAR: "ZAR",
  ZMW: "ZMW",
  ZWL: "ZWL",
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];

export const InviteStatuses = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  INVALIDATED: "INVALIDATED",
} as const;
export type InviteStatuses =
  (typeof InviteStatuses)[keyof typeof InviteStatuses];

export const BookingStatus = {
  DRAFT: "DRAFT",
  RESERVED: "RESERVED",
  ONGOING: "ONGOING",
  OVERDUE: "OVERDUE",
  COMPLETE: "COMPLETE",
  ARCHIVED: "ARCHIVED",
  CANCELLED: "CANCELLED",
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

export const KitStatus = {
  AVAILABLE: "AVAILABLE",
  IN_CUSTODY: "IN_CUSTODY",
  CHECKED_OUT: "CHECKED_OUT",
} as const;
export type KitStatus = (typeof KitStatus)[keyof typeof KitStatus];

export const UpdateStatus = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
} as const;
export type UpdateStatus = (typeof UpdateStatus)[keyof typeof UpdateStatus];

export const AuditStatus = {
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type AuditStatus = (typeof AuditStatus)[keyof typeof AuditStatus];

export const AuditAssetStatus = {
  PENDING: "PENDING",
  FOUND: "FOUND",
  MISSING: "MISSING",
  UNEXPECTED: "UNEXPECTED",
} as const;
export type AuditAssetStatus =
  (typeof AuditAssetStatus)[keyof typeof AuditAssetStatus];

export const AuditAssignmentRole = {
  LEAD: "LEAD",
  PARTICIPANT: "PARTICIPANT",
} as const;
export type AuditAssignmentRole =
  (typeof AuditAssignmentRole)[keyof typeof AuditAssignmentRole];

// New MSP enums (from migration 004)
export const PersonStatus = {
  active: "active",
  inactive: "inactive",
  terminated: "terminated",
} as const;
export type PersonStatus = (typeof PersonStatus)[keyof typeof PersonStatus];

export const SoftwareStatus = {
  active: "active",
  cancelled: "cancelled",
  trial: "trial",
} as const;
export type SoftwareStatus =
  (typeof SoftwareStatus)[keyof typeof SoftwareStatus];

export const LicenseStatus = {
  assigned: "assigned",
  revoked: "revoked",
  suspended: "suspended",
} as const;
export type LicenseStatus = (typeof LicenseStatus)[keyof typeof LicenseStatus];

export const LicenseSource = {
  liongard: "liongard",
  manual: "manual",
  entra: "entra",
} as const;
export type LicenseSource = (typeof LicenseSource)[keyof typeof LicenseSource];

export const SyncSourceSystem = {
  ninjaone: "ninjaone",
  connectwise: "connectwise",
  liongard: "liongard",
} as const;
export type SyncSourceSystem =
  (typeof SyncSourceSystem)[keyof typeof SyncSourceSystem];

export const SyncStatus = {
  ok: "ok",
  error: "error",
  stale: "stale",
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

export const ActivityAction = {
  create: "create",
  update: "update",
  delete: "delete",
} as const;
export type ActivityAction =
  (typeof ActivityAction)[keyof typeof ActivityAction];
