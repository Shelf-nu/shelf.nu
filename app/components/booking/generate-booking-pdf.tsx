import { useRef, useState } from "react";
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
  const iframeRef = useRef<HTMLIFrameElement>(null); // Add ref for the iframe
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

  const handleDownload = (e: React.MouseEvent<HTMLButtonElement>) => {
    try {
      e.preventDefault();
      const iframe = iframeRef.current;
      if (iframe && iframe?.contentDocument) {
        const pdfData = iframe?.contentDocument?.body?.innerHTML; // Adjust if necessary to access PDF data
        const blob = new Blob([pdfData], { type: "application/pdf" });
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = `booking-checklist-${new Date()
          .toISOString()
          .slice(0, 10)}.pdf`;
        a.click();
        URL.revokeObjectURL(downloadUrl);
      }
    } catch (err) {
      //do nothing for now.
    }
  };

  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="link"
            className="hidden justify-start rounded-sm px-2 py-1.5 text-left text-sm font-medium text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700 md:block"
            width="full"
            name="generate pdf"
            disabled={!totalAssets}
          >
            Generate overview PDF
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className=" hidden h-[90vh] w-[90vw] max-w-[90vw] md:flex md:flex-col">
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
              <div className={tw(iframeLoaded ? "block" : "hidden", "h-full")}>
                <iframe
                  id="pdfPreview"
                  ref={iframeRef}
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
            <Button
              to={url}
              variant="secondary"
              disabled={!iframeLoaded}
              icon="download"
              onClick={handleDownload}
            >
              Download
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Only for mobile */}
      <Button
        variant="link"
        className="block justify-start rounded-sm px-2 py-1.5 text-left text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-50 md:hidden"
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
