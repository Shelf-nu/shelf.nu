import type React from "react";
import { Button } from "../shared/button";

/**
 * A conversion-focused teaser component for premium features.
 * Shows a visually appealing preview with benefit copy and upgrade CTA.
 * Used inside widget cards when a feature is not available on the user's plan.
 *
 * Supports an optional secondary link for educating users about free alternatives
 * (e.g. NRM for custody tracking) while still nudging toward the upgrade.
 */
export function PremiumFeatureTeaser({
  headline,
  description,
  ctaLabel = "Create a Team workspace",
  ctaTo = "/account-details/workspace",
  secondaryLabel,
  secondaryTo,
  icon,
}: {
  headline: string;
  description: string;
  ctaLabel?: string;
  ctaTo?: string;
  secondaryLabel?: string;
  secondaryTo?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex size-full min-h-[200px] flex-col items-center justify-center gap-3 px-4 text-center">
      {/* Gradient icon circle */}
      <div className="flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-primary-50 to-primary-100 text-primary-600">
        {icon || (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        )}
      </div>

      {/* Headline */}
      <div className="font-semibold text-gray-900">{headline}</div>

      {/* Benefit description */}
      <p className="max-w-[260px] text-sm leading-relaxed text-gray-600">
        {description}
      </p>

      {/* Primary CTA */}
      <Button to={ctaTo} variant="primary" className="mt-1">
        {ctaLabel}
      </Button>

      {/* Optional secondary link */}
      {secondaryLabel && secondaryTo && (
        <Button
          to={secondaryTo}
          variant="link"
          className="text-xs text-gray-500"
        >
          {secondaryLabel}
        </Button>
      )}
    </div>
  );
}
