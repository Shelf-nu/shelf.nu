import {
  Button,
  Html,
  Head,
  render,
  Container,
  Heading,
  Text,
} from "@react-email/components";
import type { ClientHint } from "~/utils/client-hints";
import { getDateTimeFormatFromHints } from "~/utils/client-hints";
import { SERVER_URL } from "~/utils/env";
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
  bodyLines?: string[];
  footerLines?: string[];
  showCustodian?: boolean;
  details?: Array<{ label: string; value: string }>;
  buttonLabel?: string;
}

const renderLine = (line: string) =>
  line.split(/(\*\*.*?\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <span key={`${part}-${index}`} style={{ fontWeight: 600 }}>
          {part.slice(2, -2)}
        </span>
      );
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });

export function BookingUpdatesEmailTemplate({
  booking,
  heading,
  hints,
  assetCount,
  hideViewButton = false,
  isAdminEmail = false,
  bodyLines,
  footerLines,
  showCustodian = true,
  details,
  buttonLabel,
}: Props) {
  const fromDate = getDateTimeFormatFromHints(hints, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(booking.from as Date);
  const toDate = getDateTimeFormatFromHints(hints, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(booking.to as Date);

  const detailRows =
    details ??
    ([
      showCustodian
        ? {
            label: "Custodian",
            value:
              `${booking.custodianUser?.firstName} ${booking.custodianUser?.lastName}` ||
              booking.custodianTeamMember?.name ||
              "",
          }
        : null,
      { label: "From", value: fromDate },
      { label: "To", value: toDate },
    ].filter(Boolean) as Array<{ label: string; value: string }>);
  return (
    <Html>
      <Head>
        <title>Bookings update from Shelf.nu</title>
      </Head>

      <Container
        style={{ padding: "32px 16px", textAlign: "center", maxWidth: "100%" }}
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
          {detailRows.map((detail) => (
            <p key={detail.label} style={{ ...styles.p }}>
              <span style={{ color: "#101828", fontWeight: 600 }}>
                {detail.label}:
              </span>{" "}
              {detail.value}
            </p>
          ))}
        </div>

        {!hideViewButton && (
          <Button
            href={`${SERVER_URL}/bookings/${booking.id}?orgId=${booking.organizationId}`}
            style={{
              ...styles.button,
              textAlign: "center",
              marginBottom: "32px",
            }}
          >
            {buttonLabel ?? "View booking in app"}
          </Button>
        )}

        {bodyLines?.map((line, index) => (
          <Text key={`${line}-${index}`} style={{ ...styles.p }}>
            {renderLine(line)}
          </Text>
        ))}

        {isAdminEmail ? (
          <AdminFooter booking={booking} />
        ) : (
          <UserFooter booking={booking} />
        )}

        {footerLines?.map((line, index) => (
          <Text
            key={`${line}-${index}`}
            style={{ ...styles.p, marginTop: "12px" }}
          >
            {renderLine(line)}
          </Text>
        ))}
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
  bodyLines,
  footerLines,
  showCustodian,
  details,
  buttonLabel,
}: Props) =>
  render(
    <BookingUpdatesEmailTemplate
      booking={booking}
      heading={heading}
      assetCount={assetCount}
      hints={hints}
      hideViewButton={hideViewButton}
      isAdminEmail={isAdminEmail}
      bodyLines={bodyLines}
      footerLines={footerLines}
      showCustodian={showCustodian}
      details={details}
      buttonLabel={buttonLabel}
    />
  );
