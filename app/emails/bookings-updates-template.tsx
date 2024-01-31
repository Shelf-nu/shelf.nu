import {
  Button,
  Html,
  Text,
  Img,
  Link,
  Head,
  render,
  Container,
  Heading,
} from "@react-email/components";
import { SERVER_URL } from "~/utils/env";
import { styles } from "./styles";
import { ClientHint } from "~/modules/booking/types";
import { getDateTimeFormatFromHints } from "~/utils/client-hints";

interface Props {
  heading: string;
  booking: any;
  assetCount: number;
  hints: ClientHint;
  hideViewButton?: boolean;
}

export function BookingUpdatesEmailTemplate({
  booking,
  heading,
  hints,
  assetCount,
  hideViewButton = false,
}: Props) {
  const fromDate = getDateTimeFormatFromHints(hints, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(booking.from);
  const toDate = getDateTimeFormatFromHints(hints, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(booking.to);
  return (
    <Html>
      <Head>
        <title>Bookings update from Shelf.nu</title>
      </Head>

      <Container
        style={{ padding: "32px", textAlign: "center", maxWidth: "60%" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: "32px",
          }}
        >
          <Img
            src="cid:shelf-logo"
            alt="Shelf's logo"
            width="100"
            height="32"
            style={{ margin: "0 auto" }}
          />
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

        {!hideViewButton && (
          <Button
            href={`${SERVER_URL}/bookings/${booking.id}`}
            style={{
              ...styles.button,
              textAlign: "center",
              marginBottom: "32px",
            }}
          >
            View booking in app
          </Button>
        )}

        <Text style={{ fontSize: "14px", color: "#344054" }}>
          This email was sent to{" "}
          <Link
            style={{ color: "#EF6820" }}
            href={`mailto:${booking.custodianUser!.email}`}
          >
            {booking.custodianUser!.email}
          </Link>{" "}
          because it is part of the Shelf workspace.
          {/**
           * @TODO need to figure out how to have workspace name and owner's email in this component
           */}
          {/* <span style={{ color: "#101828", fontWeight: "600" }}>
            *{organization?.name}*
          </span>
          . If you think you weren’t supposed to have received this email please{" "}
          <Link
            style={{ color: "#344054", textDecoration: "underline" }}
            href={`mailto:${booking.custodianUser!.email}`}
          >
            contact the owner
          </Link>{" "}
          of the workspace. */}
        </Text>
        <Text
          style={{ marginBottom: "32px", fontSize: "14px", color: "#344054" }}
        >
          {" "}
          © 2024 Shelf.nu
        </Text>
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
}: Props) =>
  render(
    <BookingUpdatesEmailTemplate
      booking={booking}
      heading={heading}
      assetCount={assetCount}
      hints={hints}
      hideViewButton={hideViewButton}
    />
  );
