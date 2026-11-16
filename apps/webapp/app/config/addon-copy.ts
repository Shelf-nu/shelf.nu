/**
 * Centralised copy for add-on descriptions and feature lists.
 * Every UI surface (banners, modals, onboarding, emails) should
 * import from here so the wording stays consistent.
 */

/**
 * Shelf QR codes (creating, printing and scanning them) are free on every
 * plan. Only non-Shelf codes are gated, so every string here says what is
 * included before what the add-on adds.
 */
const BARCODE_ADDON_DESCRIPTION =
  "Use barcodes other than Shelf QR codes: Code128, Code39, EAN-13, DataMatrix, or QR codes from another system already on your gear. Shelf QR codes are included in every plan.";

export const BARCODE_ADDON = {
  label: "Alternative Barcodes",

  /** One-liner used in cards, banners, and onboarding toggles */
  description: BARCODE_ADDON_DESCRIPTION,

  /** Shorter subtitle for modal headers */
  subtitle:
    "Shelf QR codes, printing their labels and scanning them are included in every plan. This add-on is for other barcode formats, or barcodes already on your gear.",

  /** Non-owner banner - tells the user to contact the owner */
  nonOwnerDescription: `${BARCODE_ADDON_DESCRIPTION} Contact your workspace owner to enable this add-on.`,

  /** Bullet-point features for modals and emails */
  features: [
    "Add Code128, Code39, EAN-13 and DataMatrix barcodes to assets and kits",
    "Keep the barcodes already on your gear, including QR codes from another system",
    "Print labels for these barcodes",
    "Scan these barcodes to look up assets",
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
