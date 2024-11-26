import React from "react";
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import ReactDOMServer from "react-dom/server";
import { z } from "zod";
import type { PdfDbResult } from "~/modules/booking/pdf-helpers";
import {
  fetchAllPdfRelatedData,
  generatePdfContent,
  getBookingAssetsCustomHeader,
} from "~/modules/booking/pdf-helpers";
import { getDateTimeFormat } from "~/utils/client-hints";
import { SERVER_URL } from "~/utils/env";
import { makeShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const { userId } = context.getSession();
  const { bookingId } = getParams(
    params,
    z.object({
      bookingId: z.string(),
    }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId, role } = await requirePermission({
      userId: userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    const pdfMeta: PdfDbResult = await fetchAllPdfRelatedData(
      bookingId,
      organizationId,
      userId,
      role
    );
    const { from, to } = pdfMeta.booking;
    if (from && to) {
      pdfMeta.from = getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(from));

      pdfMeta.to = getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(to));
    }
    const htmlContent = ReactDOMServer.renderToString(
      <BookingPDFPreview pdfMeta={pdfMeta} />
    );
    const pdfBuffer = await generatePdfContent(
      htmlContent,
      pdfMeta,
      getBookingAssetsCustomHeader(pdfMeta)
    );
    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw json(error(reason), { status: reason.status });
  }
};

// Define the styles as a JavaScript object
const styles = {
  container: {
    width: "100%",
    maxWidth: "210mm", // A4 width
    margin: "0 auto",
    boxSizing: "border-box",
    fontFamily: "Inter",
  },
  headerText: {
    marginBottom: "20px",
  },
  headerH3: {
    padding: "unset",
    margin: "unset",
    color: "rgba(0, 0, 0, 0.6)",
  },
  headerH1: {
    fontSize: "20px",
    margin: "0",
    marginTop: "2px",
  },
  bookingInfo: {
    marginTop: "10px",
    marginBottom: "20px",
    border: "1px solid #bfbfbf",
  },
  infoRow: {
    display: "flex",
    padding: "8px",
    borderBottom: "1px solid #bfbfbf",
  },
  infoLabel: {
    fontWeight: "500",
    minWidth: "150px",
    fontSize: "14px",
  },
  infoValue: {
    flexGrow: "1",
    color: "rgba(0, 0, 0, 0.6)",
  },
  bookingTable: {
    width: "100%",
    border: "1px solid #bfbfbf",
    borderRadius: "4px !important", // Added !important flag
    borderCollapse: "collapse",
  },
  tableHeader: {
    borderBottom: "1px solid #bfbfbf",
    padding: "10px",
    textAlign: "left",
    fontSize: "10px",
    fontWeight: "500",
  },
  tableRow: {
    verticalAlign: "top",
  },
  tableCell: {
    borderBottom: "1px solid #bfbfbf",
    padding: "10px",
    textAlign: "left",
    fontSize: "14px",
    color: "rgba(0, 0, 0, 0.6)",
    wordWrap: "break-word",
  },
  qrcodeInfo: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "0.75rem",
  },
  img: {
    width: "55px",
    height: "55px",
    objectFit: "cover",
  },
  checkbox: {
    display: "block",
    height: "20px",
    width: "20px",
    border: "none",
  },
} as { [key: string]: React.CSSProperties };

const BookingPDFPreview = ({ pdfMeta }: { pdfMeta: PdfDbResult }) => {
  const { booking, organization, assets, assetIdToQrCodeMap } = pdfMeta;

  const custodianName = booking.custodianUser
    ? `${booking.custodianUser.firstName} ${booking.custodianUser.lastName} <${booking.custodianUser.email}>`
    : `${booking.custodianTeamMember?.name}`;

  return (
    <div style={styles.container}>
      <div style={styles.headerText}>
        <h3 style={styles.headerH3}>{organization?.name || ""}</h3>
        <h1 style={styles.headerH1}>
          Booking checklist for {booking?.name || ""}
        </h1>
      </div>
      <section style={styles.bookingInfo}>
        <div style={styles.infoRow}>
          <span style={styles.infoLabel}>Booking</span>
          <span style={styles.infoValue}>{booking?.name || ""}</span>
        </div>
        <div style={styles.infoRow}>
          <span style={styles.infoLabel}>Custodian</span>
          <span style={styles.infoValue}>{custodianName}</span>
        </div>
        <div style={styles.infoRow}>
          <span style={styles.infoLabel}>Booking period</span>
          <span style={styles.infoValue}>
            {pdfMeta?.from && pdfMeta?.to
              ? `${pdfMeta.from} - ${pdfMeta.to}`
              : ""}
          </span>
        </div>
        <div style={{ ...styles.infoRow, borderBottom: "unset" }}>
          <span style={styles.infoLabel}>Description</span>
          <span style={{ ...styles.infoValue, whiteSpace: "pre-wrap" }}>
            {booking?.description || ""}
          </span>
        </div>
      </section>
      <table style={styles.bookingTable}>
        <thead>
          <tr>
            <th style={styles.tableHeader}></th>
            <th style={{ ...styles.tableHeader, width: "30%" }}>Name</th>
            <th style={styles.tableHeader}>Kit</th>
            <th style={styles.tableHeader}>Category</th>
            <th style={styles.tableHeader}>Location</th>
            <th style={styles.tableHeader}>Code</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((asset, index) => (
            <tr key={index} style={styles.tableRow}>
              <td style={styles.tableCell}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{index + 1}</span>
                  <img
                    src={
                      asset?.mainImage ||
                      `${SERVER_URL}/static/images/asset-placeholder.jpg`
                    }
                    alt="Asset"
                    style={{ ...styles.img }}
                  />
                </div>
              </td>
              <td style={styles.tableCell}>{asset?.title || ""}</td>
              <td style={styles.tableCell}>{asset?.kit?.name || ""}</td>
              <td style={styles.tableCell}>{asset?.category?.name || ""}</td>
              <td style={styles.tableCell}>{asset?.location?.name || ""}</td>
              <td style={styles.tableCell}>
                <div style={styles.qrcodeInfo}>
                  <img
                    src={assetIdToQrCodeMap.get(asset.id) || ""}
                    alt="QR Code"
                    style={styles.img}
                  />
                  <input type="checkbox" style={styles.checkbox} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
