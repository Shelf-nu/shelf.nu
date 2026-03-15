// =============================================================================
// Supabase Database Types
// Hand-crafted from SQL migrations (001-008) to match supabase gen types output
// =============================================================================

import type {
  AssetStatus,
  AssetIndexMode,
  TagUseFor,
  NoteType,
  ErrorCorrection,
  BarcodeType,
  Roles,
  OrganizationType,
  QrIdDisplayPreference,
  OrganizationRoles,
  CustomFieldType,
  Currency,
  InviteStatuses,
  BookingStatus,
  KitStatus,
  UpdateStatus,
  AuditStatus,
  AuditAssetStatus,
  AuditAssignmentRole,
  PersonStatus,
  SoftwareStatus,
  LicenseStatus,
  LicenseSource,
  SyncSourceSystem,
  SyncStatus,
  ActivityAction,
} from "./enums";

// ---------------------------------------------------------------------------
// Convenience type helpers
// ---------------------------------------------------------------------------

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type Insertable<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type Updatable<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

// ---------------------------------------------------------------------------
// Database interface
// ---------------------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      Asset: {
        Row: {
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
          // MSP fields (from 003)
          person_id: string | null;
          replacement_value: number | null;
          cw_configuration_id: string | null;
          ninja_device_id: string | null;
          status_id: string | null;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          mainImage?: string | null;
          thumbnailImage?: string | null;
          mainImageExpiration?: string | null;
          status?: AssetStatus;
          value?: number | null;
          availableToBook?: boolean;
          sequentialId?: string | null;
          createdAt?: string;
          updatedAt?: string;
          userId: string;
          organizationId: string;
          categoryId?: string | null;
          locationId?: string | null;
          kitId?: string | null;
          person_id?: string | null;
          replacement_value?: number | null;
          cw_configuration_id?: string | null;
          ninja_device_id?: string | null;
          status_id?: string | null;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string | null;
          mainImage?: string | null;
          thumbnailImage?: string | null;
          mainImageExpiration?: string | null;
          status?: AssetStatus;
          value?: number | null;
          availableToBook?: boolean;
          sequentialId?: string | null;
          createdAt?: string;
          updatedAt?: string;
          userId?: string;
          organizationId?: string;
          categoryId?: string | null;
          locationId?: string | null;
          kitId?: string | null;
          person_id?: string | null;
          replacement_value?: number | null;
          cw_configuration_id?: string | null;
          ninja_device_id?: string | null;
          status_id?: string | null;
        };
      };
      AssetCustomFieldValue: {
        Row: {
          id: string;
          value: Record<string, unknown>;
          assetId: string;
          customFieldId: string;
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id?: string;
          value: Record<string, unknown>;
          assetId: string;
          customFieldId: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          value?: Record<string, unknown>;
          assetId?: string;
          customFieldId?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      AssetFilterPreset: {
        Row: {
          id: string;
          organizationId: string;
          ownerId: string;
          name: string;
          query: string;
          starred: boolean;
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id?: string;
          organizationId: string;
          ownerId: string;
          name: string;
          query: string;
          starred?: boolean;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          organizationId?: string;
          ownerId?: string;
          name?: string;
          query?: string;
          starred?: boolean;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      AssetIndexSettings: {
        Row: {
          id: string;
          userId: string;
          organizationId: string;
          mode: AssetIndexMode;
          columns: Record<string, unknown>;
          freezeColumn: boolean;
          showAssetImage: boolean;
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id?: string;
          userId: string;
          organizationId: string;
          mode?: AssetIndexMode;
          columns?: Record<string, unknown>;
          freezeColumn?: boolean;
          showAssetImage?: boolean;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          userId?: string;
          organizationId?: string;
          mode?: AssetIndexMode;
          columns?: Record<string, unknown>;
          freezeColumn?: boolean;
          showAssetImage?: boolean;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      AssetReminder: {
        Row: {
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
        Insert: {
          id?: string;
          name: string;
          message: string;
          alertDateTime: string;
          activeSchedulerReference?: string | null;
          organizationId: string;
          assetId: string;
          createdById: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          name?: string;
          message?: string;
          alertDateTime?: string;
          activeSchedulerReference?: string | null;
          organizationId?: string;
          assetId?: string;
          createdById?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      AuditAsset: {
        Row: {
          id: string;
          auditSessionId: string;
          assetId: string;
          expected: boolean;
          status: AuditAssetStatus;
          scannedById: string | null;
          scannedAt: string | null;
          metadata: Record<string, unknown> | null;
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id?: string;
          auditSessionId: string;
          assetId: string;
          expected?: boolean;
          status?: AuditAssetStatus;
          scannedById?: string | null;
          scannedAt?: string | null;
          metadata?: Record<string, unknown> | null;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          auditSessionId?: string;
          assetId?: string;
          expected?: boolean;
          status?: AuditAssetStatus;
          scannedById?: string | null;
          scannedAt?: string | null;
          metadata?: Record<string, unknown> | null;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      AuditAssignment: {
        Row: {
          id: string;
          auditSessionId: string;
          userId: string;
          role: AuditAssignmentRole | null;
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id?: string;
          auditSessionId: string;
          userId: string;
          role?: AuditAssignmentRole | null;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          auditSessionId?: string;
          userId?: string;
          role?: AuditAssignmentRole | null;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      AuditImage: {
        Row: {
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
        Insert: {
          id?: string;
          imageUrl: string;
          thumbnailUrl?: string | null;
          description?: string | null;
          auditSessionId: string;
          auditAssetId?: string | null;
          uploadedById?: string | null;
          organizationId: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          imageUrl?: string;
          thumbnailUrl?: string | null;
          description?: string | null;
          auditSessionId?: string;
          auditAssetId?: string | null;
          uploadedById?: string | null;
          organizationId?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      AuditNote: {
        Row: {
          id: string;
          content: string;
          type: NoteType;
          createdAt: string;
          updatedAt: string;
          userId: string | null;
          auditSessionId: string;
          auditAssetId: string | null;
        };
        Insert: {
          id?: string;
          content: string;
          type?: NoteType;
          createdAt?: string;
          updatedAt?: string;
          userId?: string | null;
          auditSessionId: string;
          auditAssetId?: string | null;
        };
        Update: {
          id?: string;
          content?: string;
          type?: NoteType;
          createdAt?: string;
          updatedAt?: string;
          userId?: string | null;
          auditSessionId?: string;
          auditAssetId?: string | null;
        };
      };
      AuditScan: {
        Row: {
          id: string;
          auditSessionId: string;
          auditAssetId: string | null;
          assetId: string | null;
          scannedById: string | null;
          code: string | null;
          metadata: Record<string, unknown> | null;
          scannedAt: string;
          createdAt: string;
        };
        Insert: {
          id?: string;
          auditSessionId: string;
          auditAssetId?: string | null;
          assetId?: string | null;
          scannedById?: string | null;
          code?: string | null;
          metadata?: Record<string, unknown> | null;
          scannedAt?: string;
          createdAt?: string;
        };
        Update: {
          id?: string;
          auditSessionId?: string;
          auditAssetId?: string | null;
          assetId?: string | null;
          scannedById?: string | null;
          code?: string | null;
          metadata?: Record<string, unknown> | null;
          scannedAt?: string;
          createdAt?: string;
        };
      };
      AuditSession: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          targetId: string | null;
          status: AuditStatus;
          scopeMeta: Record<string, unknown> | null;
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
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          targetId?: string | null;
          status?: AuditStatus;
          scopeMeta?: Record<string, unknown> | null;
          expectedAssetCount?: number;
          foundAssetCount?: number;
          missingAssetCount?: number;
          unexpectedAssetCount?: number;
          startedAt?: string | null;
          dueDate?: string | null;
          completedAt?: string | null;
          cancelledAt?: string | null;
          activeSchedulerReference?: string | null;
          createdById: string;
          organizationId: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          targetId?: string | null;
          status?: AuditStatus;
          scopeMeta?: Record<string, unknown> | null;
          expectedAssetCount?: number;
          foundAssetCount?: number;
          missingAssetCount?: number;
          unexpectedAssetCount?: number;
          startedAt?: string | null;
          dueDate?: string | null;
          completedAt?: string | null;
          cancelledAt?: string | null;
          activeSchedulerReference?: string | null;
          createdById?: string;
          organizationId?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      Barcode: {
        Row: {
          id: string;
          value: string;
          type: BarcodeType;
          assetId: string | null;
          kitId: string | null;
          organizationId: string;
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id?: string;
          value: string;
          type?: BarcodeType;
          assetId?: string | null;
          kitId?: string | null;
          organizationId: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          value?: string;
          type?: BarcodeType;
          assetId?: string | null;
          kitId?: string | null;
          organizationId?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      Booking: {
        Row: {
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
        Insert: {
          id?: string;
          name: string;
          status?: BookingStatus;
          description?: string | null;
          activeSchedulerReference?: string | null;
          creatorId: string;
          custodianUserId?: string | null;
          custodianTeamMemberId?: string | null;
          organizationId: string;
          createdAt?: string;
          updatedAt?: string;
          from: string;
          to: string;
          originalFrom?: string | null;
          originalTo?: string | null;
          autoArchivedAt?: string | null;
          cancellationReason?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          status?: BookingStatus;
          description?: string | null;
          activeSchedulerReference?: string | null;
          creatorId?: string;
          custodianUserId?: string | null;
          custodianTeamMemberId?: string | null;
          organizationId?: string;
          createdAt?: string;
          updatedAt?: string;
          from?: string;
          to?: string;
          originalFrom?: string | null;
          originalTo?: string | null;
          autoArchivedAt?: string | null;
          cancellationReason?: string | null;
        };
      };
      BookingNote: {
        Row: {
          id: string;
          content: string;
          type: NoteType;
          createdAt: string;
          updatedAt: string;
          userId: string | null;
          bookingId: string;
        };
        Insert: {
          id?: string;
          content: string;
          type?: NoteType;
          createdAt?: string;
          updatedAt?: string;
          userId?: string | null;
          bookingId: string;
        };
        Update: {
          id?: string;
          content?: string;
          type?: NoteType;
          createdAt?: string;
          updatedAt?: string;
          userId?: string | null;
          bookingId?: string;
        };
      };
      BookingSettings: {
        Row: {
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
        Insert: {
          id?: string;
          bufferStartTime?: number;
          tagsRequired?: boolean;
          maxBookingLength?: number | null;
          maxBookingLengthSkipClosedDays?: boolean;
          autoArchiveBookings?: boolean;
          autoArchiveDays?: number;
          requireExplicitCheckinForAdmin?: boolean;
          requireExplicitCheckinForSelfService?: boolean;
          organizationId: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          bufferStartTime?: number;
          tagsRequired?: boolean;
          maxBookingLength?: number | null;
          maxBookingLengthSkipClosedDays?: boolean;
          autoArchiveBookings?: boolean;
          autoArchiveDays?: number;
          requireExplicitCheckinForAdmin?: boolean;
          requireExplicitCheckinForSelfService?: boolean;
          organizationId?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      Category: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          color: string;
          createdAt: string;
          updatedAt: string;
          userId: string;
          organizationId: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          color: string;
          createdAt?: string;
          updatedAt?: string;
          userId: string;
          organizationId: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          color?: string;
          createdAt?: string;
          updatedAt?: string;
          userId?: string;
          organizationId?: string;
        };
      };
      CustomField: {
        Row: {
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
        Insert: {
          id?: string;
          name: string;
          helpText?: string | null;
          required?: boolean;
          active?: boolean;
          type?: CustomFieldType;
          options?: string[];
          organizationId: string;
          userId: string;
          createdAt?: string;
          updatedAt?: string;
          deletedAt?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          helpText?: string | null;
          required?: boolean;
          active?: boolean;
          type?: CustomFieldType;
          options?: string[];
          organizationId?: string;
          userId?: string;
          createdAt?: string;
          updatedAt?: string;
          deletedAt?: string | null;
        };
      };
      Custody: {
        Row: {
          id: string;
          teamMemberId: string;
          assetId: string;
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id?: string;
          teamMemberId: string;
          assetId: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          teamMemberId?: string;
          assetId?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      Image: {
        Row: {
          id: string;
          contentType: string;
          altText: string | null;
          blob: string;
          createdAt: string;
          updatedAt: string;
          ownerOrgId: string;
          userId: string;
        };
        Insert: {
          id?: string;
          contentType: string;
          altText?: string | null;
          blob: string;
          createdAt?: string;
          updatedAt?: string;
          ownerOrgId: string;
          userId: string;
        };
        Update: {
          id?: string;
          contentType?: string;
          altText?: string | null;
          blob?: string;
          createdAt?: string;
          updatedAt?: string;
          ownerOrgId?: string;
          userId?: string;
        };
      };
      Invite: {
        Row: {
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
        Insert: {
          id?: string;
          inviterId: string;
          organizationId: string;
          inviteeUserId?: string | null;
          teamMemberId: string;
          inviteeEmail: string;
          status?: InviteStatuses;
          inviteCode: string;
          roles?: OrganizationRoles[];
          inviteMessage?: string | null;
          expiresAt: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          inviterId?: string;
          organizationId?: string;
          inviteeUserId?: string | null;
          teamMemberId?: string;
          inviteeEmail?: string;
          status?: InviteStatuses;
          inviteCode?: string;
          roles?: OrganizationRoles[];
          inviteMessage?: string | null;
          expiresAt?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      Kit: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          status: KitStatus;
          image: string | null;
          imageExpiration: string | null;
          organizationId: string;
          createdById: string;
          categoryId: string | null;
          createdAt: string;
          updatedAt: string;
          locationId: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          status?: KitStatus;
          image?: string | null;
          imageExpiration?: string | null;
          organizationId: string;
          createdById: string;
          categoryId?: string | null;
          createdAt?: string;
          updatedAt?: string;
          locationId?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          status?: KitStatus;
          image?: string | null;
          imageExpiration?: string | null;
          organizationId?: string;
          createdById?: string;
          categoryId?: string | null;
          createdAt?: string;
          updatedAt?: string;
          locationId?: string | null;
        };
      };
      KitCustody: {
        Row: {
          id: string;
          custodianId: string;
          kitId: string;
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id?: string;
          custodianId: string;
          kitId: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          custodianId?: string;
          kitId?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      Location: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          address: string | null;
          latitude: number | null;
          longitude: number | null;
          imageUrl: string | null;
          thumbnailUrl: string | null;
          imageId: string | null;
          createdAt: string;
          updatedAt: string;
          userId: string;
          organizationId: string;
          parentId: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          address?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          imageUrl?: string | null;
          thumbnailUrl?: string | null;
          imageId?: string | null;
          createdAt?: string;
          updatedAt?: string;
          userId: string;
          organizationId: string;
          parentId?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          address?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          imageUrl?: string | null;
          thumbnailUrl?: string | null;
          imageId?: string | null;
          createdAt?: string;
          updatedAt?: string;
          userId?: string;
          organizationId?: string;
          parentId?: string | null;
        };
      };
      LocationNote: {
        Row: {
          id: string;
          content: string;
          type: NoteType;
          createdAt: string;
          updatedAt: string;
          userId: string | null;
          locationId: string;
        };
        Insert: {
          id?: string;
          content: string;
          type?: NoteType;
          createdAt?: string;
          updatedAt?: string;
          userId?: string | null;
          locationId: string;
        };
        Update: {
          id?: string;
          content?: string;
          type?: NoteType;
          createdAt?: string;
          updatedAt?: string;
          userId?: string | null;
          locationId?: string;
        };
      };
      Note: {
        Row: {
          id: string;
          content: string;
          type: NoteType;
          createdAt: string;
          updatedAt: string;
          userId: string | null;
          assetId: string;
        };
        Insert: {
          id?: string;
          content: string;
          type?: NoteType;
          createdAt?: string;
          updatedAt?: string;
          userId?: string | null;
          assetId: string;
        };
        Update: {
          id?: string;
          content?: string;
          type?: NoteType;
          createdAt?: string;
          updatedAt?: string;
          userId?: string | null;
          assetId?: string;
        };
      };
      Organization: {
        Row: {
          id: string;
          name: string;
          type: OrganizationType;
          userId: string;
          currency: Currency;
          imageId: string | null;
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
          createdAt: string;
          updatedAt: string;
          hasSequentialIdsMigrated: boolean;
          qrIdDisplayPreference: QrIdDisplayPreference;
          showShelfBranding: boolean;
          customEmailFooter: string | null;
          controlmap_org_id: string | null;
          tenant_tier: string;
          client_company_id: string | null;
        };
        Insert: {
          id?: string;
          name?: string;
          type?: OrganizationType;
          userId: string;
          currency?: Currency;
          imageId?: string | null;
          selfServiceCanSeeCustody?: boolean;
          selfServiceCanSeeBookings?: boolean;
          baseUserCanSeeCustody?: boolean;
          baseUserCanSeeBookings?: boolean;
          barcodesEnabled?: boolean;
          barcodesEnabledAt?: string | null;
          auditsEnabled?: boolean;
          auditsEnabledAt?: string | null;
          usedAuditTrial?: boolean;
          workspaceDisabled?: boolean;
          createdAt?: string;
          updatedAt?: string;
          hasSequentialIdsMigrated?: boolean;
          qrIdDisplayPreference?: QrIdDisplayPreference;
          showShelfBranding?: boolean;
          customEmailFooter?: string | null;
          controlmap_org_id?: string | null;
          tenant_tier?: string;
          client_company_id?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          type?: OrganizationType;
          userId?: string;
          currency?: Currency;
          imageId?: string | null;
          selfServiceCanSeeCustody?: boolean;
          selfServiceCanSeeBookings?: boolean;
          baseUserCanSeeCustody?: boolean;
          baseUserCanSeeBookings?: boolean;
          barcodesEnabled?: boolean;
          barcodesEnabledAt?: string | null;
          auditsEnabled?: boolean;
          auditsEnabledAt?: string | null;
          usedAuditTrial?: boolean;
          workspaceDisabled?: boolean;
          createdAt?: string;
          updatedAt?: string;
          hasSequentialIdsMigrated?: boolean;
          qrIdDisplayPreference?: QrIdDisplayPreference;
          showShelfBranding?: boolean;
          customEmailFooter?: string | null;
          controlmap_org_id?: string | null;
          tenant_tier?: string;
          client_company_id?: string | null;
        };
      };
      PartialBookingCheckin: {
        Row: {
          id: string;
          assetIds: string[];
          checkinCount: number;
          checkinTimestamp: string;
          bookingId: string;
          checkedInById: string;
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id?: string;
          assetIds?: string[];
          checkinCount: number;
          checkinTimestamp?: string;
          bookingId: string;
          checkedInById: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          assetIds?: string[];
          checkinCount?: number;
          checkinTimestamp?: string;
          bookingId?: string;
          checkedInById?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      PrintBatch: {
        Row: {
          id: string;
          name: string;
          printed: boolean;
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id?: string;
          name: string;
          printed?: boolean;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          name?: string;
          printed?: boolean;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      Qr: {
        Row: {
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
        Insert: {
          id?: string;
          version?: number;
          errorCorrection?: ErrorCorrection;
          assetId?: string | null;
          kitId?: string | null;
          userId?: string | null;
          organizationId?: string | null;
          batchId?: string | null;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          version?: number;
          errorCorrection?: ErrorCorrection;
          assetId?: string | null;
          kitId?: string | null;
          userId?: string | null;
          organizationId?: string | null;
          batchId?: string | null;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      ReportFound: {
        Row: {
          id: string;
          email: string;
          content: string;
          createdAt: string;
          updatedAt: string;
          assetId: string | null;
          kitId: string | null;
          is_anonymous: boolean;
        };
        Insert: {
          id?: string;
          email: string;
          content: string;
          createdAt?: string;
          updatedAt?: string;
          assetId?: string | null;
          kitId?: string | null;
          is_anonymous?: boolean;
        };
        Update: {
          id?: string;
          email?: string;
          content?: string;
          createdAt?: string;
          updatedAt?: string;
          assetId?: string | null;
          kitId?: string | null;
          is_anonymous?: boolean;
        };
      };
      Role: {
        Row: { id: string; name: Roles; createdAt: string; updatedAt: string };
        Insert: {
          id?: string;
          name?: Roles;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          name?: Roles;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      RoleChangeLog: {
        Row: {
          id: string;
          previousRole: OrganizationRoles;
          newRole: OrganizationRoles;
          createdAt: string;
          userId: string;
          changedById: string;
          organizationId: string;
        };
        Insert: {
          id?: string;
          previousRole: OrganizationRoles;
          newRole: OrganizationRoles;
          createdAt?: string;
          userId: string;
          changedById: string;
          organizationId: string;
        };
        Update: {
          id?: string;
          previousRole?: OrganizationRoles;
          newRole?: OrganizationRoles;
          createdAt?: string;
          userId?: string;
          changedById?: string;
          organizationId?: string;
        };
      };
      Scan: {
        Row: {
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
        Insert: {
          id?: string;
          latitude?: string | null;
          longitude?: string | null;
          userAgent?: string | null;
          userId?: string | null;
          qrId?: string | null;
          rawQrId: string;
          manuallyGenerated?: boolean;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          latitude?: string | null;
          longitude?: string | null;
          userAgent?: string | null;
          userId?: string | null;
          qrId?: string | null;
          rawQrId?: string;
          manuallyGenerated?: boolean;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      Tag: {
        Row: {
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
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          color?: string | null;
          useFor?: TagUseFor[];
          userId: string;
          organizationId: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          color?: string | null;
          useFor?: TagUseFor[];
          userId?: string;
          organizationId?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      TeamMember: {
        Row: {
          id: string;
          name: string;
          organizationId: string;
          userId: string | null;
          createdAt: string;
          updatedAt: string;
          deletedAt: string | null;
          person_id: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          organizationId: string;
          userId?: string | null;
          createdAt?: string;
          updatedAt?: string;
          deletedAt?: string | null;
          person_id?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          organizationId?: string;
          userId?: string | null;
          createdAt?: string;
          updatedAt?: string;
          deletedAt?: string | null;
          person_id?: string | null;
        };
      };
      Update: {
        Row: {
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
        Insert: {
          id?: string;
          title: string;
          content: string;
          url?: string | null;
          imageUrl?: string | null;
          publishDate: string;
          status?: UpdateStatus;
          targetRoles?: OrganizationRoles[];
          clickCount?: number;
          viewCount?: number;
          createdById: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          title?: string;
          content?: string;
          url?: string | null;
          imageUrl?: string | null;
          publishDate?: string;
          status?: UpdateStatus;
          targetRoles?: OrganizationRoles[];
          clickCount?: number;
          viewCount?: number;
          createdById?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      User: {
        Row: {
          id: string;
          email: string;
          username: string;
          firstName: string | null;
          lastName: string | null;
          profilePicture: string | null;
          onboarded: boolean;
          sso: boolean;
          createdWithInvite: boolean;
          lastSelectedOrganizationId: string | null;
          createdAt: string;
          updatedAt: string;
          deletedAt: string | null;
          referralSource: string | null;
        };
        Insert: {
          id?: string;
          email: string;
          username?: string;
          firstName?: string | null;
          lastName?: string | null;
          profilePicture?: string | null;
          onboarded?: boolean;
          sso?: boolean;
          createdWithInvite?: boolean;
          lastSelectedOrganizationId?: string | null;
          createdAt?: string;
          updatedAt?: string;
          deletedAt?: string | null;
          referralSource?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          username?: string;
          firstName?: string | null;
          lastName?: string | null;
          profilePicture?: string | null;
          onboarded?: boolean;
          sso?: boolean;
          createdWithInvite?: boolean;
          lastSelectedOrganizationId?: string | null;
          createdAt?: string;
          updatedAt?: string;
          deletedAt?: string | null;
          referralSource?: string | null;
        };
      };
      UserContact: {
        Row: {
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
        Insert: {
          id?: string;
          phone?: string | null;
          street?: string | null;
          city?: string | null;
          stateProvince?: string | null;
          zipPostalCode?: string | null;
          countryRegion?: string | null;
          userId: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          phone?: string | null;
          street?: string | null;
          city?: string | null;
          stateProvince?: string | null;
          zipPostalCode?: string | null;
          countryRegion?: string | null;
          userId?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      UserOrganization: {
        Row: {
          id: string;
          userId: string;
          organizationId: string;
          roles: OrganizationRoles[];
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id?: string;
          userId: string;
          organizationId: string;
          roles?: OrganizationRoles[];
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          userId?: string;
          organizationId?: string;
          roles?: OrganizationRoles[];
          createdAt?: string;
          updatedAt?: string;
        };
      };
      UserUpdateRead: {
        Row: { id: string; userId: string; updateId: string; readAt: string };
        Insert: {
          id?: string;
          userId: string;
          updateId: string;
          readAt?: string;
        };
        Update: {
          id?: string;
          userId?: string;
          updateId?: string;
          readAt?: string;
        };
      };
      WorkingHours: {
        Row: {
          id: string;
          enabled: boolean;
          weeklySchedule: Record<string, unknown>;
          organizationId: string;
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id?: string;
          enabled?: boolean;
          weeklySchedule?: Record<string, unknown>;
          organizationId: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          enabled?: boolean;
          weeklySchedule?: Record<string, unknown>;
          organizationId?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      WorkingHoursOverride: {
        Row: {
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
        Insert: {
          id?: string;
          date: string;
          isOpen?: boolean;
          openTime?: string | null;
          closeTime?: string | null;
          reason?: string | null;
          workingHoursId: string;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          date?: string;
          isOpen?: boolean;
          openTime?: string | null;
          closeTime?: string | null;
          reason?: string | null;
          workingHoursId?: string;
          createdAt?: string;
          updatedAt?: string;
        };
      };
      // Join tables
      _AssetToTag: {
        Row: { A: string; B: string };
        Insert: { A: string; B: string };
        Update: { A?: string; B?: string };
      };
      _AssetToBooking: {
        Row: { A: string; B: string };
        Insert: { A: string; B: string };
        Update: { A?: string; B?: string };
      };
      _CategoryToCustomField: {
        Row: { A: string; B: string };
        Insert: { A: string; B: string };
        Update: { A?: string; B?: string };
      };
      _TagToBooking: {
        Row: { A: string; B: string };
        Insert: { A: string; B: string };
        Update: { A?: string; B?: string };
      };
      _AssetReminderToTeamMember: {
        Row: { A: string; B: string };
        Insert: { A: string; B: string };
        Update: { A?: string; B?: string };
      };
      // New MSP tables (from 004)
      person: {
        Row: {
          id: string;
          organization_id: string;
          first_name: string;
          last_name: string;
          email: string | null;
          department: string | null;
          job_title: string | null;
          manager_id: string | null;
          start_date: string | null;
          end_date: string | null;
          m365_user_id: string | null;
          cw_contact_id: string | null;
          cw_configuration_id: string | null;
          ninja_user_id: string | null;
          liongard_user_id: string | null;
          status: PersonStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          first_name: string;
          last_name: string;
          email?: string | null;
          department?: string | null;
          job_title?: string | null;
          manager_id?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          m365_user_id?: string | null;
          cw_contact_id?: string | null;
          cw_configuration_id?: string | null;
          ninja_user_id?: string | null;
          liongard_user_id?: string | null;
          status?: PersonStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          first_name?: string;
          last_name?: string;
          email?: string | null;
          department?: string | null;
          job_title?: string | null;
          manager_id?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          m365_user_id?: string | null;
          cw_contact_id?: string | null;
          cw_configuration_id?: string | null;
          ninja_user_id?: string | null;
          liongard_user_id?: string | null;
          status?: PersonStatus;
          created_at?: string;
          updated_at?: string;
        };
      };
      vendor: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          contact_name: string | null;
          contact_email: string | null;
          website: string | null;
          controlmap_vendor_id: string | null;
          total_hardware_spend: number;
          total_software_spend: number;
          total_lease_spend: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          contact_name?: string | null;
          contact_email?: string | null;
          website?: string | null;
          controlmap_vendor_id?: string | null;
          total_hardware_spend?: number;
          total_software_spend?: number;
          total_lease_spend?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          contact_name?: string | null;
          contact_email?: string | null;
          website?: string | null;
          controlmap_vendor_id?: string | null;
          total_hardware_spend?: number;
          total_software_spend?: number;
          total_lease_spend?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      software_application: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          vendor_id: string | null;
          description: string | null;
          category: string | null;
          contract_url: string | null;
          pricing_model: string | null;
          cost_per_seat: number | null;
          total_cost: number | null;
          license_count: number | null;
          renewal_date: string | null;
          status: SoftwareStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          vendor_id?: string | null;
          description?: string | null;
          category?: string | null;
          contract_url?: string | null;
          pricing_model?: string | null;
          cost_per_seat?: number | null;
          total_cost?: number | null;
          license_count?: number | null;
          renewal_date?: string | null;
          status?: SoftwareStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          vendor_id?: string | null;
          description?: string | null;
          category?: string | null;
          contract_url?: string | null;
          pricing_model?: string | null;
          cost_per_seat?: number | null;
          total_cost?: number | null;
          license_count?: number | null;
          renewal_date?: string | null;
          status?: SoftwareStatus;
          created_at?: string;
          updated_at?: string;
        };
      };
      license_assignment: {
        Row: {
          id: string;
          person_id: string;
          software_application_id: string;
          seat_type: string | null;
          status: LicenseStatus;
          source: LicenseSource;
          source_id: string | null;
          assigned_at: string;
          revoked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          person_id: string;
          software_application_id: string;
          seat_type?: string | null;
          status?: LicenseStatus;
          source?: LicenseSource;
          source_id?: string | null;
          assigned_at?: string;
          revoked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          person_id?: string;
          software_application_id?: string;
          seat_type?: string | null;
          status?: LicenseStatus;
          source?: LicenseSource;
          source_id?: string | null;
          assigned_at?: string;
          revoked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      lease: {
        Row: {
          id: string;
          organization_id: string;
          asset_id: string | null;
          vendor_id: string | null;
          description: string;
          monthly_cost: number;
          start_date: string;
          end_date: string | null;
          reminder_days_before: number | null;
          auto_renew: boolean;
          contract_url: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          asset_id?: string | null;
          vendor_id?: string | null;
          description: string;
          monthly_cost?: number;
          start_date: string;
          end_date?: string | null;
          reminder_days_before?: number | null;
          auto_renew?: boolean;
          contract_url?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          asset_id?: string | null;
          vendor_id?: string | null;
          description?: string;
          monthly_cost?: number;
          start_date?: string;
          end_date?: string | null;
          reminder_days_before?: number | null;
          auto_renew?: boolean;
          contract_url?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      asset_sync_source: {
        Row: {
          id: string;
          asset_id: string;
          source_system: SyncSourceSystem;
          source_native_id: string;
          last_sync_at: string | null;
          sync_status: SyncStatus;
          field_overrides: Record<string, unknown>;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          asset_id: string;
          source_system: SyncSourceSystem;
          source_native_id: string;
          last_sync_at?: string | null;
          sync_status?: SyncStatus;
          field_overrides?: Record<string, unknown>;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          asset_id?: string;
          source_system?: SyncSourceSystem;
          source_native_id?: string;
          last_sync_at?: string | null;
          sync_status?: SyncStatus;
          field_overrides?: Record<string, unknown>;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      activity_log: {
        Row: {
          id: string;
          organization_id: string;
          entity_type: string;
          entity_id: string;
          action: ActivityAction;
          field_name: string | null;
          old_value: string | null;
          new_value: string | null;
          changed_by_user_id: string | null;
          changed_by_sync_source: string | null;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          entity_type: string;
          entity_id: string;
          action: ActivityAction;
          field_name?: string | null;
          old_value?: string | null;
          new_value?: string | null;
          changed_by_user_id?: string | null;
          changed_by_sync_source?: string | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          entity_type?: string;
          entity_id?: string;
          action?: ActivityAction;
          field_name?: string | null;
          old_value?: string | null;
          new_value?: string | null;
          changed_by_user_id?: string | null;
          changed_by_sync_source?: string | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
      };
      asset_status_config: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          color: string | null;
          icon: string | null;
          is_default: boolean;
          sort_order: number;
          is_system: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          color?: string | null;
          icon?: string | null;
          is_default?: boolean;
          sort_order?: number;
          is_system?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          color?: string | null;
          icon?: string | null;
          is_default?: boolean;
          sort_order?: number;
          is_system?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: {
      booking_checkout: {
        Args: {
          p_booking_id: string;
          p_asset_ids: string[];
          p_data: Record<string, unknown>;
        };
        Returns: Record<string, unknown>;
      };
      booking_checkin: {
        Args: {
          p_booking_id: string;
          p_asset_ids: string[];
          p_kit_ids: string[];
          p_status: string;
          p_active_scheduler_reference?: string | null;
        };
        Returns: Record<string, unknown>;
      };
      booking_partial_checkin: {
        Args: {
          p_booking_id: string;
          p_asset_ids: string[];
          p_complete_kit_ids: string[];
          p_checked_in_by?: string | null;
        };
        Returns: Record<string, unknown>;
      };
      booking_cancel: {
        Args: {
          p_booking_id: string;
          p_asset_ids: string[];
          p_kit_ids: string[];
          p_was_ongoing?: boolean;
        };
        Returns: Record<string, unknown>;
      };
      bulk_delete_bookings: {
        Args: {
          p_booking_ids: string[];
          p_ongoing_asset_ids: string[];
          p_kit_ids: string[];
        };
        Returns: void;
      };
      bulk_archive_bookings: {
        Args: {
          p_booking_ids: string[];
          p_ongoing_asset_ids: string[];
          p_kit_ids: string[];
        };
        Returns: void;
      };
      bulk_cancel_bookings: {
        Args: {
          p_booking_ids: string[];
          p_ongoing_asset_ids: string[];
          p_kit_ids: string[];
        };
        Returns: void;
      };
      bulk_assign_custody: {
        Args: {
          p_asset_ids: string[];
          p_team_member_id: string;
        };
        Returns: void;
      };
      bulk_release_custody: {
        Args: {
          p_asset_ids: string[];
          p_custody_ids: string[];
        };
        Returns: void;
      };
      bulk_update_location: {
        Args: {
          p_asset_ids: string[];
          p_location_id: string;
        };
        Returns: void;
      };
      transfer_org_ownership: {
        Args: {
          p_org_id: string;
          p_current_owner_id: string;
          p_new_owner_id: string;
        };
        Returns: void;
      };
      add_assets_to_booking: {
        Args: {
          p_booking_id: string;
          p_asset_ids: string[];
          p_mark_checked_out?: boolean;
        };
        Returns: Record<string, unknown>;
      };
      remove_assets_from_booking: {
        Args: {
          p_booking_id: string;
          p_asset_ids: string[];
          p_make_available?: boolean;
        };
        Returns: Record<string, unknown>;
      };
      delete_custom_field_cascade: {
        Args: {
          p_custom_field_id: string;
          p_organization_id: string;
          p_custom_field_name: string;
        };
        Returns: Record<string, unknown>;
      };
      get_location_descendants: {
        Args: {
          p_parent_id: string;
        };
        Returns: Array<{ id: string; name: string; depth: number }>;
      };
      bulk_kit_assign_custody: {
        Args: {
          p_kit_ids: string[];
          p_custodian_id: string;
        };
        Returns: void;
      };
      bulk_kit_release_custody: {
        Args: {
          p_kit_ids: string[];
        };
        Returns: void;
      };
      remove_custom_field_from_index_settings: {
        Args: {
          p_custom_field_name: string;
          p_organization_id: string;
        };
        Returns: void;
      };
      seed_default_asset_statuses: {
        Args: {
          p_org_id: string;
        };
        Returns: void;
      };
    };
    Enums: {
      asset_status: AssetStatus;
      asset_index_mode: AssetIndexMode;
      tag_use_for: TagUseFor;
      note_type: NoteType;
      error_correction: ErrorCorrection;
      barcode_type: BarcodeType;
      roles: Roles;
      organization_type: OrganizationType;
      qr_id_display_preference: QrIdDisplayPreference;
      organization_roles: OrganizationRoles;
      custom_field_type: CustomFieldType;
      currency: Currency;
      invite_statuses: InviteStatuses;
      booking_status: BookingStatus;
      kit_status: KitStatus;
      update_status: UpdateStatus;
      audit_status: AuditStatus;
      audit_asset_status: AuditAssetStatus;
      audit_assignment_role: AuditAssignmentRole;
      person_status: PersonStatus;
      software_status: SoftwareStatus;
      license_status: LicenseStatus;
      license_source: LicenseSource;
      sync_source_system: SyncSourceSystem;
      sync_status: SyncStatus;
      activity_action: ActivityAction;
    };
  };
}
