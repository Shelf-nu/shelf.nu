import { useEffect, useRef, useState } from "react";
import type {
  Asset,
  Booking,
  Organization,
  TeamMember,
  User,
} from "@prisma/client";
import { useReactToPrint } from "react-to-print";
import { Button } from "~/components/shared/button";

import { SERVER_URL } from "~/utils/env";
import { Dialog, DialogPortal } from "../layout/dialog";

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
  const url = `/bookings/${booking.id.toString()}/generate-pdf/booking-checklist-${new Date()
    .toISOString()
    .slice(0, 10)}.pdf?timeStamp=${timeStamp}`;

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
              <BookingPDFPreview
                isDialogOpen={isDialogOpen}
                bookingId={booking.id}
              />
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

interface PdfDbResult {
  booking: Booking & {
    custodianUser?: User;
    custodianTeamMember?: TeamMember;
  };
  organization: Organization;
  assets: Array<
    Asset & {
      kit?: { name: string } | null;
      category?: { name: string } | null;
      location?: { name: string } | null;
    }
  >;
  assetIdToQrCodeMap: Map<string, string>;
  from?: string;
  to?: string;
}

const BookingPDFPreview = ({
  bookingId,
  isDialogOpen,
}: {
  bookingId: string;
  isDialogOpen: boolean;
}) => {
  const [pdfMeta, setPdfMeta] = useState<PdfDbResult | null>(null);
  const [isFetchingBookings, setIsFetchingBookings] = useState(true);
  const componentRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({
    content: () => componentRef.current,
    documentTitle: `booking-${pdfMeta?.booking.id}`,
  });
  useEffect(() => {
    if (isDialogOpen) {
      fetch(`/api/bookings/${bookingId}/generate-pdf`)
        .then((response) => response.json())
        .then((data) => {
          setPdfMeta(data.pdfMeta);
        })
        .finally(() => {
          setIsFetchingBookings(false);
        });
    }
  }, [bookingId, isDialogOpen]);

  if (!pdfMeta) {
    return null;
  }
  const { booking, organization, assets, assetIdToQrCodeMap } = pdfMeta;

  const custodianName = booking.custodianUser
    ? `${booking.custodianUser.firstName} ${booking.custodianUser.lastName} <${booking.custodianUser.email}>`
    : booking.custodianTeamMember?.name;

  return (
    <>
      <button onClick={handlePrint}>Download PDF</button>
      <div
        className="mx-auto box-border w-full max-w-[210mm] border p-4 font-inter"
        ref={componentRef}
      >
        <div className="mb-5">
          <h3 className="m-0 p-0 text-gray-600">{organization?.name}</h3>
          <h1 className="mt-0.5 text-xl font-medium">
            Booking checklist for {booking?.name}
          </h1>
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
          <div className="flex p-2">
            <span className="min-w-[150px] text-sm font-medium">
              Description
            </span>
            <span className="grow whitespace-pre-wrap text-gray-600">
              {booking?.description}
            </span>
          </div>
        </section>

        <table className="w-full border-collapse rounded border border-gray-300">
          <thead>
            <tr>
              <th className="border-b border-gray-300 p-2.5 text-left text-xs font-medium"></th>
              <th className="w-[30%] border-b border-gray-300 p-2.5 text-left text-xs font-medium">
                Name
              </th>
              <th className="border-b border-gray-300 p-2.5 text-left text-xs font-medium">
                Kit
              </th>
              <th className="border-b border-gray-300 p-2.5 text-left text-xs font-medium">
                Category
              </th>
              <th className="border-b border-gray-300 p-2.5 text-left text-xs font-medium">
                Location
              </th>
              <th className="border-b border-gray-300 p-2.5 text-left text-xs font-medium">
                Code
              </th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset, index) => (
              <tr key={asset.id} className="align-top">
                <td className="border-b border-gray-300 p-2.5 text-sm text-gray-600">
                  <div className="flex items-start justify-between">
                    <span>{index + 1}</span>
                    <img
                      src={
                        asset?.mainImage ||
                        `${SERVER_URL}/static/images/asset-placeholder.jpg`
                      }
                      alt="Asset"
                      className="size-14 object-cover"
                    />
                  </div>
                </td>
                <td className="border-b border-gray-300 p-2.5 text-sm text-gray-600">
                  {asset?.title}
                </td>
                <td className="border-b border-gray-300 p-2.5 text-sm text-gray-600">
                  {asset?.kit?.name}
                </td>
                <td className="border-b border-gray-300 p-2.5 text-sm text-gray-600">
                  {asset?.category?.name}
                </td>
                <td className="border-b border-gray-300 p-2.5 text-sm text-gray-600">
                  {asset?.location?.name}
                </td>
                {/* <td className="border-b border-gray-300 p-2.5 text-sm text-gray-600">
                <div className="flex items-center gap-3">
                  <img
                    src={assetIdToQrCodeMap.get(asset.id) || ""}
                    alt="QR Code"
                    className="size-14 object-cover"
                  />
                  <input type="checkbox" className="block size-5 border-none" />
                </div>
              </td> */}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

// Print-specific CSS
const printStyles = `
  @media print {
    @page {
      size: A4;
      margin: 20mm;
    }
    
    /* Hide everything except the PDF preview */
    body > *:not(.pdf-preview) {
      display: none !important;
    }
    
    .pdf-preview {
      width: 100% !important;
      max-width: none !important;
    }
  }
`;
