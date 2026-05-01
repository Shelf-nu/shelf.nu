/**
 * At-Risk Bookings Widget
 *
 * Shows ongoing bookings that are approaching their scheduled end date.
 * Helps users take action before bookings become overdue.
 *
 * Risk levels:
 * - Critical (red): Ending today
 * - Warning (orange): Ending tomorrow
 * - Caution (yellow): Ending within 3 days
 */

import { AlertTriangle, Clock, ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { DateS } from "~/components/shared/date";
import type { AtRiskBookingData } from "~/modules/reports/types";
import { tw } from "~/utils/tw";

// Re-export with alias for backwards compatibility
export type AtRiskBooking = AtRiskBookingData;

export interface AtRiskBookingsProps {
  /** Bookings ending soon, sorted by urgency */
  bookings: AtRiskBooking[];
  /** Additional CSS classes */
  className?: string;
}

/**
 * Widget showing bookings at risk of becoming overdue.
 *
 * Actionable: Users can click through to send reminders or extend bookings.
 */
export function AtRiskBookings({ bookings, className }: AtRiskBookingsProps) {
  // Group by urgency
  const critical = bookings.filter((b) => b.hoursUntilDue <= 24);
  const warning = bookings.filter(
    (b) => b.hoursUntilDue > 24 && b.hoursUntilDue <= 48
  );
  const caution = bookings.filter(
    (b) => b.hoursUntilDue > 48 && b.hoursUntilDue <= 72
  );

  const totalAtRisk = bookings.length;

  return (
    <div
      className={tw(
        "flex flex-col rounded border border-gray-200 bg-white",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 md:px-6">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <AlertTriangle
              className={tw(
                "size-4",
                totalAtRisk > 0 ? "text-orange-500" : "text-gray-400"
              )}
            />
            <h3 className="text-sm font-semibold text-gray-900">Due Soon</h3>
            {totalAtRisk > 0 && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                {totalAtRisk}
              </span>
            )}
          </div>
          <span className="ml-6 text-xs text-gray-400">
            Bookings ending in the next 3 days
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {totalAtRisk === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-green-50">
              <Clock className="size-5 text-green-600" />
            </div>
            <p className="text-sm font-medium text-gray-900">All clear!</p>
            <p className="text-xs text-gray-500">
              No bookings at risk of becoming overdue
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {/* Critical - Ending Today */}
            {critical.length > 0 && (
              <RiskGroup
                label="Ending Today"
                bookings={critical}
                variant="critical"
              />
            )}

            {/* Warning - Ending Tomorrow */}
            {warning.length > 0 && (
              <RiskGroup
                label="Ending Tomorrow"
                bookings={warning}
                variant="warning"
              />
            )}

            {/* Caution - Ending Soon */}
            {caution.length > 0 && (
              <RiskGroup
                label="Ending in 2-3 Days"
                bookings={caution}
                variant="caution"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RiskGroup({
  label,
  bookings,
  variant,
}: {
  label: string;
  bookings: AtRiskBooking[];
  variant: "critical" | "warning" | "caution";
}) {
  // Use darker text colors for better WCAG AA contrast (4.5:1 minimum)
  const variantStyles = {
    critical: {
      dot: "bg-red-500",
      badge: "bg-red-100 text-red-800",
    },
    warning: {
      dot: "bg-orange-500",
      badge: "bg-orange-100 text-orange-800",
    },
    caution: {
      dot: "bg-yellow-500",
      badge: "bg-yellow-100 text-yellow-900",
    },
  };

  const styles = variantStyles[variant];

  return (
    <div className="py-3">
      {/* Group header */}
      <div className="flex items-center gap-2 px-4 pb-2 md:px-6">
        <span className={tw("size-2 rounded-full", styles.dot)} />
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <span
          className={tw(
            "rounded-full px-1.5 py-0.5 text-xs font-medium",
            styles.badge
          )}
        >
          {bookings.length}
        </span>
      </div>

      {/* Booking list */}
      <ul>
        {bookings.slice(0, 3).map((booking) => (
          <li key={booking.id}>
            <Link
              to={`/bookings/${booking.id}`}
              className="flex items-center justify-between px-4 py-2 transition-colors hover:bg-gray-50 md:px-6"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">
                  {booking.name}
                </p>
                <p className="text-xs text-gray-500">
                  {booking.custodian || "No custodian"}
                  {booking.assetCount > 0 && (
                    <span>
                      {" "}
                      · {booking.assetCount} asset
                      {booking.assetCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  <span>
                    {" "}
                    · Due{" "}
                    <DateS
                      date={booking.scheduledEnd}
                      options={{
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }}
                    />
                  </span>
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-gray-400" />
            </Link>
          </li>
        ))}
        {bookings.length > 3 && (
          <li className="px-4 py-2 md:px-6">
            <Link
              to="/bookings?status=ONGOING"
              className="text-xs font-medium text-primary-600 hover:text-primary-700"
            >
              View all {bookings.length} bookings →
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}

export default AtRiskBookings;
