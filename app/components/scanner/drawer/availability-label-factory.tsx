import type { ReactNode } from "react";
import { AvailabilityBadge } from "~/components/booking/availability-label";

/**
 * Configuration type for a single availability label
 */
export type AvailabilityLabelConfig = {
  /** Condition to determine if this label should be shown */
  condition: boolean;
  /** Text to display on the badge */
  badgeText: string;
  /** Title for the tooltip */
  tooltipTitle: string;
  /** Content of the tooltip */
  tooltipContent: ReactNode;
  /** Optional priority for sorting (higher numbers appear first) */
  priority?: number;
  /** Class name to be pased to the availability label */
  className?: string;
};

/**
 * Creates a set of availability labels based on the provided configurations
 * @param configs - Array of label configurations
 * @param options - Optional settings for how labels are displayed
 * @returns A tuple with [hasLabels, LabelsComponent]
 */
export function createAvailabilityLabels(
  configs: AvailabilityLabelConfig[],
  options: {
    /** Maximum number of labels to show (default: show all) */
    maxLabels?: number;
    /** Sort labels by priority (default: true) */
    sortByPriority?: boolean;
  } = {}
): [boolean, React.FC] {
  const { maxLabels, sortByPriority = true } = options;

  // Filter the active labels based on conditions
  let activeLabels = configs.filter((config) => config.condition);

  // Sort by priority if enabled (higher numbers come first)
  if (sortByPriority) {
    activeLabels = activeLabels.sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    );
  }

  // Limit the number of labels if maxLabels is set
  if (maxLabels !== undefined && activeLabels.length > maxLabels) {
    activeLabels = activeLabels.slice(0, maxLabels);
  }

  const hasLabels = activeLabels.length > 0;

  // Create the component that will render the labels
  const AvailabilityLabels: React.FC = () => {
    if (!hasLabels) return null;

    return (
      <div className="flex flex-wrap gap-1">
        {activeLabels.map((label, index) => (
          <AvailabilityBadge
            key={`label-${index}`}
            badgeText={label.badgeText}
            tooltipTitle={label.tooltipTitle}
            tooltipContent={label.tooltipContent}
            className={label.className}
          />
        ))}
      </div>
    );
  };

  return [hasLabels, AvailabilityLabels];
}

/**
 * Predefined label configurations for common asset states
 */
export const assetLabelPresets = {
  inCustody: (isInCustody: boolean = false): AvailabilityLabelConfig => ({
    condition: isInCustody,
    badgeText: "In custody",
    tooltipTitle: "Asset is in custody",
    tooltipContent:
      "This asset is already in custody. You need to release it before assigning it again.",
    priority: 100,
  }),

  checkedOut: (isCheckedOut: boolean = false): AvailabilityLabelConfig => ({
    condition: isCheckedOut,
    badgeText: "Checked out",
    tooltipTitle: "Asset is checked out",
    tooltipContent:
      "This asset is already checked out. You need to check it in before assigning it custody.",
    priority: 90,
  }),

  partOfKit: (isPartOfKit: boolean = false): AvailabilityLabelConfig => ({
    condition: isPartOfKit,
    badgeText: "Part of kit",
    tooltipTitle: "Asset is part of a kit",
    tooltipContent: "Remove the asset from the kit to add it individually.",
    priority: 80,
  }),

  unavailable: (isUnavailable: boolean = false): AvailabilityLabelConfig => ({
    condition: isUnavailable,
    badgeText: "Unavailable",
    tooltipTitle: "Asset is unavailable",
    tooltipContent: "This asset is marked as unavailable and cannot be used.",
    priority: 110,
  }),

  alreadyInBooking: (
    isInBooking: boolean = false
  ): AvailabilityLabelConfig => ({
    condition: isInBooking,
    badgeText: "Already in booking",
    tooltipTitle: "Asset is already in this booking",
    tooltipContent: "This asset is already added to the current booking.",
    priority: 70,
  }),
};

/**
 * Predefined label configurations for common kit states
 */
export const kitLabelPresets = {
  inCustody: (isInCustody: boolean = false): AvailabilityLabelConfig => ({
    condition: isInCustody,
    badgeText: "In custody",
    tooltipTitle: "Kit is in custody",
    tooltipContent:
      "This kit is already in custody. You need to release it before assigning it again.",
    priority: 100,
  }),

  checkedOut: (isCheckedOut: boolean = false): AvailabilityLabelConfig => ({
    condition: isCheckedOut,
    badgeText: "Checked out",
    tooltipTitle: "Kit is checked out",
    tooltipContent:
      "This kit is already checked out. You need to check it in before assigning it custody.",
    priority: 90,
  }),

  hasAssetsInCustody: (
    hasInCustody: boolean = false
  ): AvailabilityLabelConfig => ({
    condition: hasInCustody,
    badgeText: "Contains assets in custody",
    tooltipTitle: "Kit contains assets in custody",
    tooltipContent:
      "Some assets in this kit are already in custody. Release them first before assigning the kit.",
    priority: 85,
  }),

  containsUnavailableAssets: (
    hasUnavailable: boolean = false
  ): AvailabilityLabelConfig => ({
    condition: hasUnavailable,
    badgeText: "Contains unavailable assets",
    tooltipTitle: "Kit contains unavailable assets",
    tooltipContent:
      "Some assets in this kit are marked as unavailable. Address this before proceeding.",
    priority: 110,
  }),
};
