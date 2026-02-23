import {
  Button,
  Html,
  Head,
  render,
  Container,
  Heading,
} from "@react-email/components";
import {
  BOOKING_EMAIL_ASSETS_DISPLAY_LIMIT,
  type ReservationEmailAsset,
} from "~/modules/booking/constants";
import type { ClientHint } from "~/utils/client-hints";
import { getDateTimeFormatFromHints } from "~/utils/client-hints";
import { SERVER_URL } from "~/utils/env";
import { CustomEmailFooter } from "./components/custom-footer";
import { AdminFooter, UserFooter } from "./components/footers";
import { LogoForEmail } from "./logo";
import { styles } from "./styles";
import type { BookingForEmail } from "./types";

interface Props {
  heading: string;
  booking: BookingForEmail;
  assetCount: number;
  hints: ClientHint;
  hideViewButton?: boolean;
  isAdminEmail?: boolean;
  cancellationReason?: string;
  changes?: string[];
  /** Only provided for reservation emails */
  assets?: ReservationEmailAsset[];
}

export function BookingUpdatesEmailTemplate({
  booking,
  heading,
  hints,
  assetCount,
  hideViewButton = false,
  isAdminEmail = false,
  cancellationReason,
  changes,
  assets,
}: Props) {
  const fromDate = getDateTimeFormatFromHints(hints, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(booking.from as Date);
  const toDate = getDateTimeFormatFromHints(hints, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(booking.to as Date);
  return (
    <Html>
      <Head>
        <title>Bookings update from Shelf.nu</title>
      </Head>

      <Container
        style={{
          padding: "32px 16px",
          textAlign: "center",
          maxWidth: "600px",
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: "32px",
          }}
        >
          <LogoForEmail />
        </div>
        <div style={{ margin: "32px" }}>
          <Heading as="h1" style={{ ...styles.h1 }}>
            {heading}
          </Heading>
          <Heading as="h2" style={{ ...styles.h2 }}>
            {booking.name} | {assetCount}{" "}
            {assetCount === 1 ? "asset" : "assets"}
          </Heading>
          <p style={{ ...styles.p }}>
            <span style={{ color: "#101828", fontWeight: "600" }}>
              Custodian:
            </span>{" "}
            {`${booking.custodianUser?.firstName} ${booking.custodianUser?.lastName}` ||
              booking.custodianTeamMember?.name}
          </p>
          <p style={{ ...styles.p }}>
            <span style={{ color: "#101828", fontWeight: "600" }}>From:</span>{" "}
            {fromDate}
          </p>
          <p style={{ ...styles.p }}>
            <span style={{ color: "#101828", fontWeight: "600" }}>To:</span>{" "}
            {toDate}
          </p>
        </div>

        {assets && assets.length > 0 && (
          <div
            style={{
              textAlign: "left",
              margin: "24px 32px",
              backgroundColor: "#F9FAFB",
              borderRadius: "8px",
              border: "1px solid #EAECF0",
              padding: "16px 20px",
            }}
          >
            <p
              style={{
                ...styles.p,
                fontWeight: "600",
                color: "#101828",
                marginBottom: "12px",
              }}
            >
              Booked items:
            </p>
            {assets
              .slice(0, BOOKING_EMAIL_ASSETS_DISPLAY_LIMIT)
              .map((asset) => (
                <div
                  key={asset.id}
                  style={{
                    padding: "6px 0",
                    borderBottom: "1px solid #EAECF0",
                  }}
                >
                  <span
                    style={{
                      ...styles.p,
                      margin: "0",
                      color: "#101828",
                      fontWeight: "500",
                    }}
                  >
                    {asset.title}
                  </span>
                  {asset.category?.name && (
                    <span
                      style={{
                        ...styles.p,
                        margin: "0 0 0 8px",
                        color: "#667085",
                        fontSize: "13px",
                      }}
                    >
                      · {asset.category.name}
                    </span>
                  )}
                </div>
              ))}
            {assets.length > BOOKING_EMAIL_ASSETS_DISPLAY_LIMIT && (
              <p
                style={{
                  ...styles.p,
                  color: "#667085",
                  fontSize: "13px",
                  marginTop: "8px",
                }}
              >
                and {assets.length - BOOKING_EMAIL_ASSETS_DISPLAY_LIMIT} more —{" "}
                <a
                  href={`${SERVER_URL}/bookings/${booking.id}?orgId=${booking.organizationId}`}
                  style={{ color: "#EF6820" }}
                >
                  View full booking
                </a>
              </p>
            )}
          </div>
        )}

        {cancellationReason && (
          <div
            style={{
              margin: "0 0 24px",
              padding: "16px",
              borderLeft: "4px solid #F79009",
              backgroundColor: "#FFFAEB",
              textAlign: "left",
              borderRadius: "4px",
            }}
          >
            <p
              style={{
                ...styles.p,
                margin: "0 0 4px",
                fontWeight: "600",
              }}
            >
              Cancellation reason
            </p>
            <p style={{ ...styles.p, margin: "0" }}>{cancellationReason}</p>
          </div>
        )}

        {changes && changes.length > 0 && (
          <div
            style={{
              textAlign: "left",
              margin: "24px 0",
              backgroundColor: "#F9FAFB",
              borderRadius: "8px",
              border: "1px solid #EAECF0",
              padding: "16px 20px",
            }}
          >
            <p
              style={{
                ...styles.p,
                fontWeight: "600",
                color: "#101828",
                marginBottom: "8px",
              }}
            >
              What changed:
            </p>
            <ul style={{ margin: "0", paddingLeft: "20px" }}>
              {changes.map((change, i) => (
                <li key={i} style={{ ...styles.li, marginBottom: "4px" }}>
                  {change}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!hideViewButton && (
          <Button
            href={`${SERVER_URL}/bookings/${booking.id}?orgId=${booking.organizationId}`}
            style={{
              ...styles.button,
              textAlign: "center",
              marginBottom: "32px",
            }}
          >
            View booking in app
          </Button>
        )}

        <CustomEmailFooter
          footerText={booking.organization.customEmailFooter}
        />

        {isAdminEmail ? (
          <AdminFooter booking={booking} />
        ) : (
          <UserFooter booking={booking} />
        )}
      </Container>
    </Html>
  );
}

/*
 *The HTML content of an email will be accessed by a server file to send email,
  we cannot import a TSX component in a server file so we are exporting TSX converted to HTML string using render function by react-email.
 */
export const bookingUpdatesTemplateString = ({
  booking,
  heading,
  assetCount,
  hints,
  hideViewButton = false,
  isAdminEmail = false,
  cancellationReason,
  changes,
  assets,
}: Props) =>
  render(
    <BookingUpdatesEmailTemplate
      booking={booking}
      heading={heading}
      assetCount={assetCount}
      hints={hints}
      hideViewButton={hideViewButton}
      isAdminEmail={isAdminEmail}
      cancellationReason={cancellationReason}
      changes={changes}
      assets={assets}
    />
  );
