import { Heading, Img } from "@react-email/components";
import { config } from "~/config/shelf.config";
import { SERVER_URL } from "~/utils/env";

export function LogoForEmail() {
  const { logoPath } = config;
  return (
    <div style={{ margin: "0 auto", display: "flex" }}>
      <Img
        src={`${SERVER_URL}/static/images/logo-full-color(x2).png`}
        alt="Shelf's logo"
        width="auto"
        height="32"
        style={{ marginRight: "6px", width: "auto", height: "32px" }}
      />
      {logoPath?.fullLogo ? null : (
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
      )}
    </div>
  );
}
