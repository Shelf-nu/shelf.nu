import {
  Button,
  Html,
  Head,
  render,
  Container,
  Heading,
} from "@react-email/components";
import type { ClientHint } from "~/utils/client-hints";
import { getDateTimeFormatFromHints } from "~/utils/client-hints";
import { SERVER_URL } from "~/utils/env";
import { AdminFooter, UserFooter } from "./components/footers";
import { LogoForEmail } from "./logo";
import { styles } from "./styles";
import type { BookingForEmail, EmailAsset } from "./types";

interface Props {
  heading: string;
  booking: BookingForEmail;
  assetCount: number;
  assets?: EmailAsset[];
  hints: ClientHint;
  hideViewButton?: boolean;
  isAdminEmail?: boolean;
  cancellationReason?: string;
}

/**
 * Groups assets by kit. Returns kit groups (kit name + its assets)
 * and standalone assets (not part of any kit).
 */
function groupAssetsByKit(assets: EmailAsset[]) {
  const kits = new Map<string, { name: string; assets: EmailAsset[] }>();
  const standalone: EmailAsset[] = [];

  for (const asset of assets) {
    if (asset.kit) {
      const existing = kits.get(asset.kit.id);
      if (existing) {
        existing.assets.push(asset);
      } else {
        kits.set(asset.kit.id, { name: asset.kit.name, assets: [asset] });
      }
    } else {
      standalone.push(asset);
    }
  }

  return { kits: Array.from(kits.values()), standalone };
}

export function BookingUpdatesEmailTemplate({
  booking,
  heading,
  hints,
  assetCount,
  assets,
  hideViewButton = false,
  isAdminEmail = false,
  cancellationReason,
}: Props) {
  const fromDate = getDateTimeFormatFromHints(hints, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(booking.from as Date);
  const toDate = getDateTimeFormatFromHints(hints, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(booking.to as Date);

  const hasAssets = assets && assets.length > 0;
  const grouped = hasAssets ? groupAssetsByKit(assets) : null;
  const remainingCount = hasAssets ? assetCount - assets.length : 0;
  const bookingUrl = `${SERVER_URL}/bookings/${booking.id}?orgId=${booking.organizationId}`;

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

        {grouped && (
          <div
            style={{
              margin: "0 32px 24px",
              textAlign: "left",
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
              Booked items
            </p>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "14px",
                color: "#344054",
              }}
            >
              <tbody>
                {grouped.kits.map((kit) => (
                  <>
                    <tr key={`kit-${kit.name}`}>
                      <td
                        style={{
                          padding: "8px 0 4px",
                          fontWeight: "600",
                          color: "#101828",
                          borderBottom: "1px solid #EAECF0",
                        }}
                      >
                        Kit: {kit.name}
                      </td>
                    </tr>
                    {kit.assets.map((asset) => (
                      <tr key={asset.id}>
                        <td
                          style={{
                            padding: "4px 0 4px 16px",
                            color: "#344054",
                          }}
                        >
                          {asset.title}
                        </td>
                      </tr>
                    ))}
                  </>
                ))}
                {grouped.standalone.length > 0 && grouped.kits.length > 0 && (
                  <tr>
                    <td
                      style={{
                        padding: "8px 0 4px",
                        fontWeight: "600",
                        color: "#101828",
                        borderBottom: "1px solid #EAECF0",
                      }}
                    >
                      Individual assets
                    </td>
                  </tr>
                )}
                {grouped.standalone.map((asset) => (
                  <tr key={asset.id}>
                    <td
                      style={{
                        padding: "4px 0 4px",
                        paddingLeft:
                          grouped.kits.length > 0 ? "16px" : undefined,
                        color: "#344054",
                      }}
                    >
                      {asset.title}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {remainingCount > 0 && (
              <p
                style={{
                  fontSize: "14px",
                  color: "#667085",
                  marginTop: "8px",
                }}
              >
                ... and {remainingCount} more{" "}
                {remainingCount === 1 ? "item" : "items"} &mdash;{" "}
                <a href={bookingUrl} style={{ color: "#EF6820" }}>
                  View full booking
                </a>
              </p>
            )}
          </div>
        )}

        {cancellationReason && (
          <div
            style={{
              margin: "0 32px 24px",
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

        {!hideViewButton && (
          <Button
            href={bookingUrl}
            style={{
              ...styles.button,
              textAlign: "center",
              marginBottom: "32px",
            }}
          >
            View booking in app
          </Button>
        )}

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
  assets,
  hints,
  hideViewButton = false,
  isAdminEmail = false,
  cancellationReason,
}: Props) =>
  render(
    <BookingUpdatesEmailTemplate
      booking={booking}
      heading={heading}
      assetCount={assetCount}
      assets={assets}
      hints={hints}
      hideViewButton={hideViewButton}
      isAdminEmail={isAdminEmail}
      cancellationReason={cancellationReason}
    />
  );
