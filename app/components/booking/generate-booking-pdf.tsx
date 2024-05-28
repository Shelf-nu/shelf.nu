import { useEffect, useState } from "react";
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
import { Spinner } from "../shared/spinner";

export const GenerateBookingPdf = ({ booking }: { booking: any }) => {
  const [url, setUrl] = useState("");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIframeLoaded(false);
    if (booking && booking?.assets?.length) {
      const timestamp = new Date().getTime();
      setUrl(
        `/bookings/${booking.id}/generate-pdf/${
          booking.name || "booking-assets"
        }-${new Date().toISOString().slice(0, 10)}.pdf?timeStamp=${timestamp}`
      );
    } else {
      setErrorMessage("No assets available to generate PDF.");
    }
  }, [booking, booking?.assets]);

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
              className="justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-50"
              width="full"
              name="generate pdf"
              disabled={!booking?.assets?.length}
            >
              Generate PDF...
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              {/* {icon changes} */}
              {/* <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              
            </span>
          </div> */}
              <AlertDialogTitle>
                Generate Booking Checklist PDF for {booking?.name}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {errorMessage ||
                  "You can either preview the PDF or download it."}
                {!iframeLoaded && (
                  <div className="h-500 m-4 flex flex-1 flex-col items-center justify-center text-center">
                    <Spinner />
                    <p className="mt-2">Generating PDF...</p>
                  </div>
                )}
                {booking?.assets?.length && (
                  <div style={{ display: iframeLoaded ? "block" : "none" }}>
                    <iframe
                      id="pdfPreview"
                      width="100%"
                      height="500px"
                      onLoad={handleIframeLoad}
                      className="mt-4"
                      src={url}
                      title="Booking PDF"
                      allowFullScreen={true}
                    />
                  </div>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <div className="flex justify-center gap-2">
                {/* <Button to={url} variant="secondary" role="link" download={true} reloadDocument={true} disabled={!iframeLoaded}>
              Download PDF
            </Button> */}
                <AlertDialogCancel asChild>
                  <Button variant="secondary">Cancel</Button>
                </AlertDialogCancel>
              </div>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Button
          variant="link"
          className="justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-50"
          width="full"
          name="generate pdf"
          disabled={!booking?.assets?.length}
          onClick={handleMobileView}
        >
          Generate PDF...
        </Button>
      )}
    </>
  );
};
