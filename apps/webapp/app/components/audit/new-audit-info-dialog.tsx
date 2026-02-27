import { useState } from "react";
import { CompassIcon, MapPinIcon, PackageIcon } from "lucide-react";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";

export function NewAuditInfoDialog() {
  const [open, setOpen] = useState(false);

  const handleClose = () => setOpen(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>New Audit</Button>
      <DialogPortal>
        <Dialog
          open={open}
          onClose={handleClose}
          className="w-full sm:w-[500px]"
          title={<h3 className="text-lg font-semibold">Create a New Audit</h3>}
        >
          <div className="px-6 pb-6">
            <p className="mb-6 text-sm text-color-600">
              Audits help you verify your asset inventory by checking that
              expected assets are in their designated locations. Choose how
              you'd like to create your audit:
            </p>

            <div className="space-y-4">
              {/* From Assets */}
              <div className="rounded-lg border border-color-200 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                    <CompassIcon className="size-5 text-primary-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="mb-1 font-medium text-color-900">
                      From Assets list (advanced mode)
                    </h4>
                    <p className="mb-3 text-sm text-color-600">
                      Select specific assets from your inventory to include in
                      the audit. Perfect for targeted checks of particular
                      items. Use the actions menu on the Assets page to get
                      started.
                    </p>
                    <Button
                      to="/assets"
                      variant="secondary"
                      size="xs"
                      onClick={handleClose}
                    >
                      Go to Assets
                    </Button>
                  </div>
                </div>
              </div>

              {/* From Location */}
              <div className="rounded-lg border border-color-200 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                    <MapPinIcon className="size-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="mb-1 font-medium text-color-900">
                      From Location page
                    </h4>
                    <p className="mb-3 text-sm text-color-600">
                      Audit all assets assigned to a specific location. Ideal
                      for room-by-room or area-based inventory checks. Use the
                      actions menu on the Location page to get started.
                    </p>
                    <Button
                      to="/locations"
                      variant="secondary"
                      size="xs"
                      onClick={handleClose}
                    >
                      Go to Locations
                    </Button>
                  </div>
                </div>
              </div>

              {/* From Kit */}
              <div className="rounded-lg border border-color-200 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-green-50">
                    <PackageIcon className="size-5 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="mb-1 font-medium text-color-900">
                      From Kit
                    </h4>
                    <p className="mb-3 text-sm text-color-600">
                      Audit all assets within a specific kit. Great for
                      verifying that kit contents are complete. Use the actions
                      menu on the Kit page to get started.
                    </p>
                    <Button
                      to="/kits"
                      variant="secondary"
                      size="xs"
                      onClick={handleClose}
                    >
                      Go to Kits
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}
