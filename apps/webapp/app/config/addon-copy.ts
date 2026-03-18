/**
 * Centralised copy for add-on descriptions and feature lists.
 * Every UI surface (banners, modals, onboarding, emails) should
 * import from here so the wording stays consistent.
 */

export const BARCODE_ADDON = {
  label: "Alternative Barcodes",

  /** One-liner used in cards, banners, and onboarding toggles */
  description:
    "Generate new barcodes or use your existing ones. Supports Code128, Code39, EAN-13, DataMatrix & QR codes — ideal for migrations.",

  /** Shorter subtitle for modal headers */
  subtitle:
    "Add support for industry-standard barcode formats to your workspace.",

  /** Non-owner banner — tells the user to contact the owner */
  nonOwnerDescription:
    "Generate new barcodes or use your existing ones. Supports Code128, Code39, EAN-13, DataMatrix & QR codes — ideal for migrations. Contact your workspace owner to enable this feature.",

  /** Bullet-point features for modals and emails */
  features: [
    "Supports Code128, Code39, EAN-13, DataMatrix & QR codes",
    "Generate new barcode labels or use your existing ones",
    "Print barcode labels for your assets",
    "Built-in barcode scanner for quick asset lookups",
  ],
} as const;

export const AUDIT_ADDON = {
  label: "Audits",

  /** One-liner used in cards, banners, and onboarding toggles */
  description:
    "Create audits, assign auditors, scan QR codes, and track asset verification in real-time.",

  /** Shorter subtitle for modal/page headers */
  subtitle: "Add powerful audit capabilities to your workspace.",

  /** Non-owner message on the unlock page */
  nonOwnerDescription:
    "Contact your workspace owner to enable the Audits add-on for your organization.",

  /** Bullet-point features for modals, unlock page, and emails */
  features: [
    "Create audits and assign auditors to verify your assets",
    "Set due dates and track progress in real-time",
    "Use QR code scanning for quick asset verification",
    "Generate detailed audit reports",
  ],
} as const;
