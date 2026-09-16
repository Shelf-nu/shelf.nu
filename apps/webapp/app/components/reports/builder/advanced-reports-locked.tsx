/**
 * What `/reports/builder` shows a workspace without the Advanced Reports
 * add-on: what the builder does and who to ask. No prices here; the
 * subscription flow that sells the add-on has its own unlock page.
 *
 * @see {@link file://../../../routes/_layout+/reports.builder.tsx}
 */

import { SlidersHorizontal } from "lucide-react";
import { Button } from "~/components/shared/button";

/** Props for {@link AdvancedReportsLocked}. */
type Props = {
  /** Owners see the "ask us" call to action; others are told to ask an owner. */
  isOwner: boolean;
};

/** Renders the locked-state card. */
export function AdvancedReportsLocked({ isOwner }: Props) {
  return (
    <div className="mx-auto max-w-xl rounded border border-gray-200 bg-white p-8 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-600">
        <SlidersHorizontal className="size-6" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900">
        Advanced Reports is not enabled for this workspace
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        The report builder lets you pick the data (assets, bookings or custody),
        group it by category, location, asset model, custom field and more,
        choose a measure, filter it, and export the result.
      </p>
      <p className="mt-2 text-sm text-gray-600">
        {isOwner
          ? "Advanced Reports is a workspace add-on. Get in touch and we will switch it on for you."
          : "Advanced Reports is a workspace add-on. Ask a workspace owner to get in touch with us."}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Button to="/reports" variant="secondary">
          Back to reports
        </Button>
        {isOwner ? (
          <Button
            as="a"
            href="mailto:support@shelf.nu?subject=Advanced%20Reports"
            variant="primary"
          >
            Contact us
          </Button>
        ) : null}
      </div>
    </div>
  );
}
