import type { Booking } from "@prisma/client";
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

interface Props {
  heading: string;
  booking: any;
  assetCount: number;
}

export function BookingUpdatesEmailTemplate({
  booking,
  heading,
  assetCount,
}: Props) {
  return (
    <Html>
      <Head>
        <title>Bookings update from Shelf.nu</title>
      </Head>

      <Container style={{ padding: "32px", textAlign: "center" }}>
        <Img
          src="cid:shelf-logo"
          alt="Shelf's logo"
          width="100"
          height="32"
          style={{ margin: "0 auto 32px auto" }}
        />
        <div style={{ marginBottom: "32px" }}>
          <Heading as="h1" style={{ ...styles.h1 }}>
            {heading}
          </Heading>
          <Heading as="h2" style={{ ...styles.h2 }}>
            {booking.id} | {booking.name} | {assetCount}{" "}
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
            {booking.from.toLocaleString()}
          </p>
          <p style={{ ...styles.p }}>
            <span style={{ color: "#101828", fontWeight: "600" }}>To:</span>{" "}
            {booking.to.toLocaleString()}
          </p>
        </div>
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

        <Text style={{ fontSize: "14px", color: "#344054" }}>
          This email was sent to{" "}
          <Link
            style={{ color: "#EF6820" }}
            href={`mailto:${booking.custodianUser!.email}`}
          >
            {booking.custodianUser!.email}
          </Link>{" "}
          because it is part of the Shelf workspace. If you think you weren’t
          supposed to have received this email please{" "}
          <Link
            style={{ color: "#344054", textDecoration: "underline" }}
            href={`mailto:${booking.custodianUser!.email}`}
          >
            contact the owner
          </Link>{" "}
          of the workspace.
        </Text>
        <Text
          style={{ marginBottom: "32px", fontSize: "14px", color: "#344054" }}
        >
          {" "}
          © 2023 Shelf.nu, Meander 901, 6825 MH Arnhem
        </Text>
      </Container>
    </Html>
  );
}

export const bookingUpdatesTemplateString = ({
  booking,
  heading,
  assetCount,
}: Props) =>
  render(
    <BookingUpdatesEmailTemplate
      booking={booking}
      heading={heading}
      assetCount={assetCount}
    />
  );
