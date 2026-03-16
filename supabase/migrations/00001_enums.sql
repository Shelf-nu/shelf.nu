-- Enums: All PostgreSQL enum types that replace Prisma schema enums
-- These must be created before any tables that reference them.

-- Asset status
CREATE TYPE "AssetStatus" AS ENUM ('AVAILABLE', 'IN_CUSTODY', 'CHECKED_OUT');

-- Asset index mode
CREATE TYPE "AssetIndexMode" AS ENUM ('SIMPLE', 'ADVANCED');

-- Note type (shared across Note, BookingNote, LocationNote, AuditNote)
CREATE TYPE "NoteType" AS ENUM ('COMMENT', 'UPDATE');

-- QR error correction level
CREATE TYPE "ErrorCorrection" AS ENUM ('L', 'M', 'Q', 'H');

-- Barcode types (matching zxing format names)
CREATE TYPE "BarcodeType" AS ENUM ('Code128', 'Code39', 'DataMatrix', 'ExternalQR', 'EAN13');

-- Tag usage scope
CREATE TYPE "TagUseFor" AS ENUM ('ASSET', 'BOOKING');

-- User roles (master data)
CREATE TYPE "Roles" AS ENUM ('USER', 'ADMIN');

-- Organization type
CREATE TYPE "OrganizationType" AS ENUM ('PERSONAL', 'TEAM');

-- QR ID display preference
CREATE TYPE "QrIdDisplayPreference" AS ENUM ('QR_ID', 'SAM_ID');

-- Organization-level roles
CREATE TYPE "OrganizationRoles" AS ENUM ('ADMIN', 'BASE', 'OWNER', 'SELF_SERVICE');

-- Invite statuses
CREATE TYPE "InviteStatuses" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'INVALIDATED');

-- Booking status
CREATE TYPE "BookingStatus" AS ENUM (
  'DRAFT', 'RESERVED', 'ONGOING', 'OVERDUE',
  'COMPLETE', 'ARCHIVED', 'CANCELLED'
);

-- Kit status
CREATE TYPE "KitStatus" AS ENUM ('AVAILABLE', 'IN_CUSTODY', 'CHECKED_OUT');

-- Tier IDs (correspond to Stripe products)
CREATE TYPE "TierId" AS ENUM ('free', 'tier_1', 'tier_2', 'custom');

-- Custom field types
CREATE TYPE "CustomFieldType" AS ENUM (
  'TEXT', 'OPTION', 'BOOLEAN', 'DATE',
  'MULTILINE_TEXT', 'AMOUNT', 'NUMBER'
);

-- Update status
CREATE TYPE "UpdateStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- Audit status
CREATE TYPE "AuditStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- Audit asset status
CREATE TYPE "AuditAssetStatus" AS ENUM ('PENDING', 'FOUND', 'MISSING', 'UNEXPECTED');

-- Audit assignment role
CREATE TYPE "AuditAssignmentRole" AS ENUM ('LEAD', 'PARTICIPANT');

-- ISO 4217 Currency Codes
CREATE TYPE "Currency" AS ENUM (
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL',
  'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CLP', 'CNY',
  'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP',
  'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD',
  'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR',
  'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF',
  'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL',
  'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR',
  'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR',
  'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR',
  'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD',
  'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB',
  'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX',
  'USD', 'UYU', 'UZS', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD', 'XOF',
  'XPF', 'YER', 'ZAR', 'ZMW', 'ZWL'
);
