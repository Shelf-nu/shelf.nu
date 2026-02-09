import { Heading, Img } from "@react-email/components";
import { config } from "~/config/shelf.config";
import { SERVER_URL } from "~/utils/env";

/**
 * Logo URL for emails. We always use the production URL because email clients
 * (like Gmail) cannot load images from localhost during local development.
 */
const EMAIL_LOGO_URL = SERVER_URL.includes("localhost")
  ? "https://app.shelf.nu/static/images/logo-full-color(x2).png"
  : `${SERVER_URL}/static/images/logo-full-color(x2).png`;

export function LogoForEmail() {
  const { logoPath } = config;
  return (
    <table
      cellPadding="0"
      cellSpacing="0"
      role="presentation"
      style={{ margin: "0 auto" }}
    >
      <tr>
        <td style={{ verticalAlign: "middle", paddingRight: "6px" }}>
          <Img
            src={EMAIL_LOGO_URL}
            alt="Shelf's logo"
            width="auto"
            height="32"
            style={{ width: "auto", height: "32px", display: "block" }}
          />
        </td>
        {logoPath?.fullLogo ? null : (
          <td style={{ verticalAlign: "middle" }}>
            <Heading
              as="h1"
              style={{
                color: "#101828",
                fontWeight: "600",
                margin: "0",
              }}
            >
              shelf
            </Heading>
          </td>
        )}
      </tr>
    </table>
  );
}
