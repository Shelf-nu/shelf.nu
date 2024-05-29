import { useEffect, useState } from "react";
import type { Asset, Booking } from "@prisma/client";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import { tw } from "~/utils/tw";
import { Spinner } from "../shared/spinner";

export const GenerateBookingPdf = ({
  booking,
}: {
  booking: {
    id: Booking["id"];
    name: Booking["name"];
    assets: Partial<Asset>[];
  };
}) => {
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const totalAssets = booking.assets.length;
  const url = `/bookings/${booking.id.toString()}/generate-pdf/${
    booking.name
  }-${new Date()
    .toISOString()
    .slice(0, 10)}.pdf?timeStamp=${new Date().getTime()}`;

  useEffect(() => {
    const isMobileDevice = /Mobi/.test(navigator.userAgent);
    setIsMobile(isMobileDevice);
  }, []);

  const handleIframeLoad = () => {
    setIframeLoaded(true);
  };

  const handleMobileView = () => {
    window.location.href = url;
  };

  return (
    <>
      {!isMobile ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="link"
              className="justify-start rounded-sm px-2 py-1.5 text-left text-sm font-medium text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700"
              width="full"
              name="generate pdf"
              disabled={!totalAssets}
            >
              Generate overview PDF
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="flex h-[90vh] w-[90vw] max-w-[90vw] flex-col">
            <AlertDialogHeader>
              <AlertDialogTitle>
                Generate booking checklist for "{booking?.name}"
              </AlertDialogTitle>
              <AlertDialogDescription>
                You can either preview or download the PDF.
              </AlertDialogDescription>
            </AlertDialogHeader>
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
                    className="mt-4"
                    src={url}
                    title="Booking PDF"
                    allowFullScreen={true}
                  />
                </div>
              )}
            </div>
            <AlertDialogFooter className="mt-4">
              <AlertDialogCancel asChild>
                <Button variant="secondary">Cancel</Button>
              </AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Button
          variant="link"
          className="justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-50"
          width="full"
          name="generate pdf"
          disabled={!totalAssets}
          onClick={handleMobileView}
        >
          Generate PDF...
        </Button>
      )}
    </>
  );
};
