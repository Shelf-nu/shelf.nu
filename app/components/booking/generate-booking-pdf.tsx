import { useState } from "react";
import type { Asset, Booking } from "@prisma/client";
import { Button } from "~/components/shared/button";

import { tw } from "~/utils/tw";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Spinner } from "../shared/spinner";

export const GenerateBookingPdf = ({
  booking,
  timeStamp,
}: {
  booking: {
    id: Booking["id"];
    name: Booking["name"];
    assets: Partial<Asset>[];
  };
  timeStamp: number;
}) => {
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const totalAssets = booking.assets.length;
  const url = `/bookings/${booking.id.toString()}/generate-pdf/booking-checklist-${new Date()
    .toISOString()
    .slice(0, 10)}.pdf?timeStamp=${timeStamp}`;
  const handleIframeLoad = () => {
    setIframeLoaded(true);
  };

  const handleMobileView = () => {
    window.location.href = url;
  };

  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
  };

  return (
    <>
      <Button
        variant="link"
        className="hidden justify-start rounded-sm px-2 py-1.5 text-left text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700 md:block"
        width="full"
        name="generate pdf"
        onClick={handleOpenDialog}
        disabled={!totalAssets}
      >
        Generate overview PDF
      </Button>
      <DialogPortal>
        <Dialog
          open={isDialogOpen}
          onClose={handleCloseDialog}
          className="h-[90vh] w-full py-0 md:h-[calc(100vh-4rem)]  md:w-[90%]"
          title={
            <div>
              <h3>Generate booking checklist for "{booking?.name}"</h3>
              <p>You can either preview or download the PDF.</p>
            </div>
          }
        >
          <div className="flex h-full flex-col px-6">
            <div className="grow">
              {/** Show spinner if no iframe */}
              {!iframeLoaded && (
                <div className="m-4  flex h-full flex-1 flex-col items-center justify-center text-center">
                  <Spinner />
                  <p className="mt-2">Generating PDF...</p>
                </div>
              )}
              {totalAssets && (
                <div
                  className={tw(iframeLoaded ? "block" : "hidden", "h-full")}
                >
                  <iframe
                    id="pdfPreview"
                    width="100%"
                    height="100%"
                    onLoad={handleIframeLoad}
                    src={url}
                    title="Booking PDF"
                    allowFullScreen={true}
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 py-4">
              <Button variant="secondary" onClick={handleCloseDialog}>
                Cancel
              </Button>
            </div>
          </div>
        </Dialog>
      </DialogPortal>

      {/* Only for mobile */}
      <Button
        variant="link"
        className="block justify-start rounded-sm px-2 py-1.5 text-left text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700  md:hidden"
        width="full"
        name="generate pdf"
        disabled={!totalAssets}
        onClick={handleMobileView}
      >
        Generate overview PDF
      </Button>
    </>
  );
};
