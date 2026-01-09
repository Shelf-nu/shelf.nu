/**
 * Pricing feature types for Shelf.nu
 *
 * IMPORTANT ARCHITECTURE NOTES:
 *
 * Shelf uses a dual gating system:
 *
 * 1. Subscription Tiers (on User model - User.tierId):
 *    - free, tier_1, tier_2, custom
 *    - Controls: import/export, custom field limits, workspace count, branding
 *    - Source: app/database/schema.prisma (TierId enum)
 *
 * 2. Organization Types (on Organization model - Organization.type):
 *    - PERSONAL (single-user) or TEAM (multi-user)
 *    - Controls: bookings, team member invites, collaboration features
 *    - Source: app/database/schema.prisma (OrganizationType enum)
 *
 * 3. Environment-level (ENABLE_PREMIUM_FEATURES flag):
 *    - When disabled (self-hosted mode), all tier-gated features are unlocked
 *    - Source: app/utils/subscription.server.ts
 */

export type AvailabilityState =
  | "included"
  | "not-included"
  | "limited"
  | "requires-team-org"; // Requires TEAM organization type (not tier-based)

export interface PricingFeature {
  id: string;
  category: string;
  name: string;
  description?: string;
  // Display availability (using marketing names)
  availability: {
    free: AvailabilityState;
    plus: AvailabilityState;
    team: AvailabilityState;
    enterprise: AvailabilityState;
  };
  // Internal truth (using database tier IDs)
  internalAvailability: {
    free: AvailabilityState;
    tier_1: AvailabilityState;
    tier_2: AvailabilityState;
    custom: AvailabilityState;
  };
  metadata?: {
    free?: string;
    plus?: string;
    team?: string;
    enterprise?: string;
  };
  /**
   * True if feature requires Organization.type === TEAM
   * (independent of subscription tier)
   */
  requiresTeamOrg?: boolean;
  /**
   * True if feature is gated when ENABLE_PREMIUM_FEATURES=true
   * (unlocked in self-hosted mode when flag is false)
   */
  requiresPremiumEnabled?: boolean;
}

export const pricingFeatures: PricingFeature[] = [
  // ============================================================================
  // ASSET MANAGEMENT
  // ============================================================================
  {
    id: "asset-limit",
    category: "Asset Management",
    name: "Assets",
    description: "Unlimited assets across all plans",
    availability: {
      free: "included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
    metadata: {
      free: "Unlimited",
      plus: "Unlimited",
      team: "Unlimited",
      enterprise: "Unlimited",
    },
  },
  {
    id: "qr-codes",
    category: "Asset Management",
    name: "Asset QR Codes",
    description: "Create, print and scan QR labels for assets",
    availability: {
      free: "included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
  },
  {
    id: "tags-categories",
    category: "Asset Management",
    name: "Tags & Categories",
    description: "Unlimited tags and categories for organization",
    availability: {
      free: "included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
  },
  {
    id: "kits",
    category: "Asset Management",
    name: "Kits",
    description: "Create kits of assets and manage them as bundles",
    availability: {
      free: "included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
  },
  {
    id: "custom-fields",
    category: "Asset Management",
    name: "Custom Fields",
    description: "Custom properties for asset mapping",
    availability: {
      free: "limited",
      plus: "limited",
      team: "limited",
      enterprise: "limited",
    },
    internalAvailability: {
      free: "limited",
      tier_1: "limited",
      tier_2: "limited",
      custom: "limited",
    },
    metadata: {
      free: "3 custom fields",
      plus: "100 custom fields",
      team: "100 custom fields",
      enterprise: "1000 custom fields",
    },
    requiresPremiumEnabled: true,
  },
  {
    id: "asset-reminders",
    category: "Asset Management",
    name: "Asset Reminders",
    description:
      "Schedule reminders and alerts for assets with email notifications",
    availability: {
      free: "included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
  },

  // ============================================================================
  // STORAGE & FILES
  // ============================================================================
  {
    id: "max-file-size",
    category: "Storage & Files",
    name: "Max File Size",
    description: "Maximum file size per asset (photos/documents)",
    availability: {
      free: "limited",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "limited",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
    metadata: {
      free: "5 MB per file",
      plus: "Unlimited",
      team: "Unlimited",
      enterprise: "Unlimited",
    },
  },
  {
    id: "file-storage",
    category: "Storage & Files",
    name: "File Storage",
    description: "Total storage for asset files",
    availability: {
      free: "included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
    metadata: {
      free: "Unlimited (within file size limit)",
      plus: "Unlimited",
      team: "Unlimited",
      enterprise: "Unlimited",
    },
  },

  // ============================================================================
  // WORKSPACE MANAGEMENT
  // ============================================================================
  {
    id: "workspaces",
    category: "Workspace Management",
    name: "Workspaces",
    description: "Number of organizations/workspaces you can create",
    availability: {
      free: "limited",
      plus: "limited",
      team: "limited",
      enterprise: "included",
    },
    internalAvailability: {
      free: "limited",
      tier_1: "limited",
      tier_2: "limited",
      custom: "included",
    },
    metadata: {
      free: "1 workspace (Personal org only)",
      plus: "1 workspace",
      team: "2 workspaces",
      enterprise: "Unlimited workspaces",
    },
    requiresPremiumEnabled: true,
  },
  {
    id: "hide-shelf-branding",
    category: "Workspace Management",
    name: "Remove Shelf Branding",
    description: "Hide Shelf branding on printable QR labels",
    availability: {
      free: "not-included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "not-included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
    requiresPremiumEnabled: true,
  },

  // ============================================================================
  // TEAM COLLABORATION
  // ============================================================================
  {
    id: "team-members",
    category: "Team Collaboration",
    name: "Team Members",
    description: "Invite team members to collaborate (requires TEAM workspace)",
    availability: {
      free: "requires-team-org",
      plus: "requires-team-org",
      team: "requires-team-org",
      enterprise: "requires-team-org",
    },
    internalAvailability: {
      free: "requires-team-org",
      tier_1: "requires-team-org",
      tier_2: "requires-team-org",
      custom: "requires-team-org",
    },
    metadata: {
      free: "Unlimited (TEAM workspace only)",
      plus: "Unlimited (TEAM workspace only)",
      team: "Unlimited (TEAM workspace only)",
      enterprise: "Unlimited (TEAM workspace only)",
    },
    requiresTeamOrg: true,
  },
  {
    id: "role-based-access",
    category: "Team Collaboration",
    name: "Role-Based Access",
    description: "User roles: Owner, Admin, Base, Self-service",
    availability: {
      free: "included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
  },

  // ============================================================================
  // BOOKINGS & RESERVATIONS
  // ============================================================================
  {
    id: "bookings",
    category: "Bookings & Reservations",
    name: "Bookings",
    description:
      "Reserve assets with start/end dates and custodian assignment (requires TEAM workspace)",
    availability: {
      free: "requires-team-org",
      plus: "requires-team-org",
      team: "requires-team-org",
      enterprise: "requires-team-org",
    },
    internalAvailability: {
      free: "requires-team-org",
      tier_1: "requires-team-org",
      tier_2: "requires-team-org",
      custom: "requires-team-org",
    },
    requiresTeamOrg: true,
    requiresPremiumEnabled: true,
  },
  {
    id: "booking-calendar",
    category: "Bookings & Reservations",
    name: "Booking Calendar",
    description:
      "Calendar view for asset availability and bookings (requires TEAM workspace)",
    availability: {
      free: "requires-team-org",
      plus: "requires-team-org",
      team: "requires-team-org",
      enterprise: "requires-team-org",
    },
    internalAvailability: {
      free: "requires-team-org",
      tier_1: "requires-team-org",
      tier_2: "requires-team-org",
      custom: "requires-team-org",
    },
    requiresTeamOrg: true,
    requiresPremiumEnabled: true,
  },
  {
    id: "working-hours",
    category: "Bookings & Reservations",
    name: "Working Hours",
    description:
      "Configure weekly schedules and holiday overrides for availability (requires TEAM workspace)",
    availability: {
      free: "requires-team-org",
      plus: "requires-team-org",
      team: "requires-team-org",
      enterprise: "requires-team-org",
    },
    internalAvailability: {
      free: "requires-team-org",
      tier_1: "requires-team-org",
      tier_2: "requires-team-org",
      custom: "requires-team-org",
    },
    requiresTeamOrg: true,
  },
  {
    id: "self-checkouts",
    category: "Bookings & Reservations",
    name: "Self-Checkouts",
    description: "Allow members to check out and check in items",
    availability: {
      free: "included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
  },

  // ============================================================================
  // SEARCH & FILTERING
  // ============================================================================
  {
    id: "global-search",
    category: "Search & Filtering",
    name: "Global Search",
    description: "Full-text search across assets, bookings, and more",
    availability: {
      free: "included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
  },
  {
    id: "advanced-filters",
    category: "Search & Filtering",
    name: "Advanced Filters",
    description: "Filter and sort assets by many properties",
    availability: {
      free: "included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
  },

  // ============================================================================
  // LOCATION & TRACKING
  // ============================================================================
  {
    id: "locations",
    category: "Location & Tracking",
    name: "Locations",
    description: "Location hierarchy and GPS coordinates for assets",
    availability: {
      free: "included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
  },

  // ============================================================================
  // DATA IMPORT/EXPORT
  // ============================================================================
  {
    id: "csv-import-assets",
    category: "Data Import/Export",
    name: "Import Assets (CSV)",
    description: "Bulk import assets via CSV file",
    availability: {
      free: "not-included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "not-included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
    requiresPremiumEnabled: true,
  },
  {
    id: "csv-export-assets",
    category: "Data Import/Export",
    name: "Export Assets (CSV)",
    description: "Bulk export assets to CSV file",
    availability: {
      free: "not-included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "not-included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
    requiresPremiumEnabled: true,
  },
  {
    id: "import-nrm",
    category: "Data Import/Export",
    name: "Import Non-Registered Members",
    description: "Bulk import team members without email invites",
    availability: {
      free: "not-included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "not-included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
    requiresPremiumEnabled: true,
  },

  // ============================================================================
  // REPORTS & EXPORTS
  // ============================================================================
  {
    id: "booking-pdf",
    category: "Reports & Exports",
    name: "Booking PDFs",
    description: "Export booking details as PDF (requires TEAM workspace)",
    availability: {
      free: "requires-team-org",
      plus: "requires-team-org",
      team: "requires-team-org",
      enterprise: "requires-team-org",
    },
    internalAvailability: {
      free: "requires-team-org",
      tier_1: "requires-team-org",
      tier_2: "requires-team-org",
      custom: "requires-team-org",
    },
    requiresTeamOrg: true,
  },
  {
    id: "qr-export",
    category: "Reports & Exports",
    name: "Bulk QR Code Export",
    description: "Download multiple QR codes at once",
    availability: {
      free: "included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
  },

  // ============================================================================
  // INTEGRATIONS
  // ============================================================================
  {
    id: "webhooks",
    category: "Integrations",
    name: "Webhooks",
    description: "Webhook capabilities for automation",
    availability: {
      free: "included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
  },
  {
    id: "sso-saml",
    category: "Integrations",
    name: "SSO/SAML",
    description: "Single Sign-On via Azure, Google Workspace, etc.",
    availability: {
      free: "not-included",
      plus: "not-included",
      team: "limited",
      enterprise: "included",
    },
    internalAvailability: {
      free: "not-included",
      tier_1: "not-included",
      tier_2: "limited",
      custom: "included",
    },
    metadata: {
      free: "Not available",
      plus: "Not available",
      team: "Available on request",
      enterprise: "Fully supported",
    },
  },
  {
    id: "scim",
    category: "Integrations",
    name: "SCIM",
    description: "System for Cross-domain Identity Management",
    availability: {
      free: "not-included",
      plus: "not-included",
      team: "limited",
      enterprise: "included",
    },
    internalAvailability: {
      free: "not-included",
      tier_1: "not-included",
      tier_2: "limited",
      custom: "included",
    },
    metadata: {
      free: "Not available",
      plus: "Not available",
      team: "Available on request",
      enterprise: "Fully supported",
    },
  },

  // ============================================================================
  // DEPLOYMENT
  // ============================================================================
  {
    id: "self-hosting",
    category: "Deployment",
    name: "Self-Hosting",
    description:
      "Deploy Shelf on your own infrastructure (feature gating controlled by ENABLE_PREMIUM_FEATURES flag)",
    availability: {
      free: "included",
      plus: "included",
      team: "included",
      enterprise: "included",
    },
    internalAvailability: {
      free: "included",
      tier_1: "included",
      tier_2: "included",
      custom: "included",
    },
    metadata: {
      free: "Open source",
      plus: "Open source",
      team: "Open source",
      enterprise: "Enterprise support available",
    },
  },
];

/**
 * Helper to get internal tier ID from display name
 */
export function getInternalTierId(
  displayTier: "free" | "plus" | "team" | "enterprise"
): "free" | "tier_1" | "tier_2" | "custom" {
  const mapping = {
    free: "free",
    plus: "tier_1",
    team: "tier_2",
    enterprise: "custom",
  } as const;
  return mapping[displayTier];
}

/**
 * Helper to get display name from internal tier ID
 */
export function getDisplayTierName(
  tierId: "free" | "tier_1" | "tier_2" | "custom"
): "free" | "plus" | "team" | "enterprise" {
  const mapping = {
    free: "free",
    tier_1: "plus",
    tier_2: "team",
    custom: "enterprise",
  } as const;
  return mapping[tierId];
}
