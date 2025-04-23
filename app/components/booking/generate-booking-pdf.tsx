import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { Asset, Booking } from "@prisma/client";
import { useReactToPrint } from "react-to-print";
import { Button } from "~/components/shared/button";

import type { PdfDbResult } from "~/modules/booking/pdf-helpers";
import { tw } from "~/utils/tw";
import { AssetImage } from "../assets/asset-image";
import { Dialog, DialogPortal } from "../layout/dialog";
import { DateS } from "../shared/date";
import { Spinner } from "../shared/spinner";
import When from "../when/when";

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
  const totalAssets = booking.assets.length;
  const componentRef = useRef<HTMLDivElement>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pdfMeta, setPdfMeta] = useState<PdfDbResult | null>(null);
  const [isFetchingBookings, setIsFetchingBookings] = useState(true);

  useEffect(() => {
    if (isDialogOpen) {
      fetch(`/api/bookings/${booking.id}/generate-pdf`)
        .then((response) => response.json())
        .then((data) => {
          setPdfMeta(data.pdfMeta);
        })
        .finally(() => {
          setIsFetchingBookings(false);
        });
    }
  }, [booking, isDialogOpen]);

  const handlePrint = useReactToPrint({
    content: () => componentRef.current,
    documentTitle: `booking-${booking.name}-${timeStamp}`,
  });

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
            <div className="mx-auto w-full max-w-[210mm] border p-4 text-center">
              <h3>Generate booking checklist for "{booking?.name}"</h3>
              <p>You can either preview or download the PDF.</p>
              {!isFetchingBookings && (
                <div className="mt-4">
                  <Button onClick={handlePrint}>Download PDF</Button>
                </div>
              )}
            </div>
          }
        >
          <div className="flex h-full flex-col px-6">
            <div className="grow">
              {isFetchingBookings ? (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <div>Generating PDF preview...</div>
                  <div>
                    <Spinner />
                  </div>
                </div>
              ) : (
                <BookingPDFPreview
                  pdfMeta={pdfMeta}
                  componentRef={componentRef}
                />
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
        // onClick={handleMobileView}
      >
        Generate overview PDF
      </Button>
    </>
  );
};

const BookingPDFPreview = ({
  componentRef,
  pdfMeta,
}: {
  componentRef: RefObject<HTMLDivElement>;
  pdfMeta: PdfDbResult | null;
}) => {
  if (!pdfMeta) return null;

  const { booking, organization, assets, assetIdToQrCodeMap } = pdfMeta;
  const custodianName = booking.custodianUser
    ? `${booking.custodianUser.firstName} ${booking.custodianUser.lastName} <${booking.custodianUser.email}>`
    : booking.custodianTeamMember?.name;

  /** Check if the `originalFrom` date is different from `from` date */
  const isFromDifferentFromOriginal =
    !!pdfMeta.originalFrom && pdfMeta.originalFrom !== pdfMeta.from;

  /** Check if the `originalTo` date is different from `to` date */
  const isToDifferentFromOriginal =
    !!pdfMeta.originalTo && pdfMeta.originalTo !== pdfMeta.to;

  const isPeriodDifferentFromOriginal =
    isFromDifferentFromOriginal || isToDifferentFromOriginal;

  return (
    <div className="border bg-gray-200 py-4">
      <style>
        {`@media print {
          @page {
            margin: 10mm;  /* Adjust margin size as needed */
            size: A4;
          }
          .pdf-wrapper {
            margin: 0;
            padding: 0;
          }

      }`}
      </style>
      <div
        className="pdf-wrapper mx-auto w-[200mm] bg-white p-[10mm] font-inter"
        ref={componentRef}
      >
        <div className="mb-5 flex justify-between">
          <div>
            <h3 className="m-0 p-0 text-gray-600">{organization?.name}</h3>
            <h1 className="mt-0.5 text-xl font-medium">
              Booking checklist for {booking?.name}
            </h1>
          </div>
          <div className="text-gray-500">
            {booking.name} | <DateS date={new Date()} />
          </div>
        </div>

        <section className="mb-5 mt-2.5 border border-gray-300">
          <div className="flex border-b border-gray-300 p-2">
            <span className="min-w-[150px] text-sm font-medium">Booking</span>
            <span className="grow text-gray-600">{booking?.name}</span>
          </div>
          <div className="flex border-b border-gray-300 p-2">
            <span className="min-w-[150px] text-sm font-medium">Custodian</span>
            <span className="grow text-gray-600">{custodianName}</span>
          </div>
          <div className="flex border-b border-gray-300 p-2">
            <span className="min-w-[150px] text-sm font-medium">
              Booking period
            </span>
            <span className="grow text-gray-600">
              {pdfMeta?.from && pdfMeta?.to
                ? `${pdfMeta.from} - ${pdfMeta.to}`
                : ""}
            </span>
          </div>

          {/* If from and to  */}
          <When truthy={isPeriodDifferentFromOriginal}>
            <div className="flex border-b border-gray-300 p-2">
              <span className="min-w-[150px] text-sm font-medium">
                Original period
              </span>
              <span className="grow text-gray-600">{`${
                isFromDifferentFromOriginal
                  ? pdfMeta.originalFrom
                  : pdfMeta.from
              } - ${
                isToDifferentFromOriginal ? pdfMeta.originalTo : pdfMeta.to
              }`}</span>
            </div>
          </When>

          <div className="flex p-2">
            <span className="min-w-[150px] text-sm font-medium">
              Description
            </span>
            <span className="grow whitespace-pre-wrap text-gray-600">
              {booking?.description}
            </span>
          </div>
        </section>

        <table className="w-full border-collapse border border-gray-300">
          <thead>
            <tr>
              <th className="w-10 border-b border-r border-gray-300 p-2.5 text-left text-xs font-medium">
                #
              </th>
              <th className="w-20 min-w-[76px] border-b border-r border-gray-300 p-2.5 text-left text-xs font-medium">
                Image
              </th>
              <th className="w-[30%] border-b border-r border-gray-300 p-2.5 text-left text-xs font-medium">
                Name
              </th>
              <th className="w-24 border-b border-r border-gray-300 p-2.5 text-left text-xs font-medium">
                Kit
              </th>
              <th className="w-24 border-b border-r border-gray-300 p-2.5 text-left text-xs font-medium">
                Category
              </th>
              <th className="w-24 border-b border-r border-gray-300 p-2.5 text-left text-xs font-medium">
                Location
              </th>
              <th className="min-w-[120px] border-b border-r border-gray-300 p-2.5 text-left text-xs font-medium">
                Code
              </th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset, index) => (
              <>
                <tr
                  key={asset.id}
                  className={tw(
                    "align-top",
                    !asset.description && "border-b border-gray-300"
                  )}
                >
                  <td className="border-r border-gray-300 p-2.5 text-sm text-gray-600">
                    {index + 1}
                  </td>
                  <td className="border-r border-gray-300 p-2.5 text-sm text-gray-600">
                    <AssetImage
                      asset={{
                        assetId: asset.id,
                        mainImage: asset.mainImage,
                        thumbnailImage: asset.thumbnailImage,
                        mainImageExpiration: asset.mainImageExpiration,
                        alt: asset.title,
                      }}
                      className="!size-14 object-cover"
                      useThumbnail
                    />
                  </td>
                  <td className="border-r border-gray-300 p-2.5 text-sm text-gray-600">
                    {asset?.title}
                  </td>
                  <td className="border-r border-gray-300 p-2.5 text-sm text-gray-600">
                    {asset?.kit?.name}
                  </td>
                  <td className="border-r border-gray-300 p-2.5 text-sm text-gray-600">
                    {asset?.category?.name}
                  </td>
                  <td className="border-r border-gray-300 p-2.5 text-sm text-gray-600">
                    {asset?.location?.name}
                  </td>
                  <td className="border-r border-gray-300 p-2.5 text-sm text-gray-600">
                    <div className="flex items-center gap-3">
                      <img
                        src={assetIdToQrCodeMap[asset.id] || ""}
                        alt="QR Code"
                        className="size-14 object-cover"
                      />
                      <input type="checkbox" className="block size-5 border" />
                    </div>
                  </td>
                </tr>

                <When truthy={!!asset.description}>
                  <tr className="border-b border-gray-300 align-top">
                    <td colSpan={7} className="m-2 p-2">
                      <div className="flex items-start gap-4 bg-gray-100 p-4">
                        <div className="w-20 text-xs">Asset Description</div>
                        <div className="flex-1 text-sm">
                          {asset.description}
                        </div>
                      </div>
                    </td>
                  </tr>
                </When>
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
