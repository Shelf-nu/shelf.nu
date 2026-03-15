// =============================================================================
// Model type aliases
// Convenience re-exports so consumers can write `Asset` instead of `Tables<'Asset'>`
// =============================================================================

import type { Tables } from "./types";

// ---------------------------------------------------------------------------
// Shelf base models
// ---------------------------------------------------------------------------
export type Asset = Tables<"Asset">;
export type AssetCustomFieldValue = Tables<"AssetCustomFieldValue">;
export type AssetFilterPreset = Tables<"AssetFilterPreset">;
export type AssetIndexSettings = Tables<"AssetIndexSettings">;
export type AssetReminder = Tables<"AssetReminder">;
export type AuditAsset = Tables<"AuditAsset">;
export type AuditAssignment = Tables<"AuditAssignment">;
export type AuditImage = Tables<"AuditImage">;
export type AuditNote = Tables<"AuditNote">;
export type AuditScan = Tables<"AuditScan">;
export type AuditSession = Tables<"AuditSession">;
export type Barcode = Tables<"Barcode">;
export type Booking = Tables<"Booking">;
export type BookingNote = Tables<"BookingNote">;
export type BookingSettings = Tables<"BookingSettings">;
export type Category = Tables<"Category">;
export type CustomField = Tables<"CustomField">;
export type Custody = Tables<"Custody">;
export type Image = Tables<"Image">;
export type Invite = Tables<"Invite">;
export type Kit = Tables<"Kit">;
export type KitCustody = Tables<"KitCustody">;
export type Location = Tables<"Location">;
export type LocationNote = Tables<"LocationNote">;
export type Note = Tables<"Note">;
export type Organization = Tables<"Organization">;
export type PartialBookingCheckin = Tables<"PartialBookingCheckin">;
export type PrintBatch = Tables<"PrintBatch">;
export type Qr = Tables<"Qr">;
export type ReportFound = Tables<"ReportFound">;
export type Role = Tables<"Role">;
export type RoleChangeLog = Tables<"RoleChangeLog">;
export type Scan = Tables<"Scan">;
export type Tag = Tables<"Tag">;
export type TeamMember = Tables<"TeamMember">;
export type Update = Tables<"Update">;
export type User = Tables<"User">;
export type UserContact = Tables<"UserContact">;
export type UserOrganization = Tables<"UserOrganization">;
export type UserUpdateRead = Tables<"UserUpdateRead">;
export type WorkingHours = Tables<"WorkingHours">;
export type WorkingHoursOverride = Tables<"WorkingHoursOverride">;

// ---------------------------------------------------------------------------
// Join tables
// ---------------------------------------------------------------------------
export type AssetToTag = Tables<"_AssetToTag">;
export type AssetToBooking = Tables<"_AssetToBooking">;
export type CategoryToCustomField = Tables<"_CategoryToCustomField">;
export type TagToBooking = Tables<"_TagToBooking">;
export type AssetReminderToTeamMember = Tables<"_AssetReminderToTeamMember">;

// ---------------------------------------------------------------------------
// MSP tables
// ---------------------------------------------------------------------------
export type Person = Tables<"person">;
export type Vendor = Tables<"vendor">;
export type SoftwareApplication = Tables<"software_application">;
export type LicenseAssignment = Tables<"license_assignment">;
export type Lease = Tables<"lease">;
export type AssetSyncSource = Tables<"asset_sync_source">;
export type ActivityLog = Tables<"activity_log">;
export type AssetStatusConfig = Tables<"asset_status_config">;
