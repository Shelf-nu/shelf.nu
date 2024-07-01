import { Text, Link } from "@react-email/components";
import { config } from "~/config/shelf.config";
import type { BookingForEmail } from "../types";

/** Footer used when sending normal user emails */
export const UserFooter = ({ booking }: { booking: BookingForEmail }) => (
  <>
    <Text style={{ fontSize: "14px", color: "#344054" }}>
      This email was sent to{" "}
      <Link
        style={{ color: config.emailPrimaryColor }}
        href={`mailto:${booking.custodianUser!.email}`}
      >
        {booking.custodianUser!.email}
      </Link>{" "}
      because it is part of the workspace{" "}
      <span style={{ color: "#101828", fontWeight: "600" }}>
        "{booking.organization.name}"
      </span>
      . <br /> If you think you weren’t supposed to have received this email
      please{" "}
      <Link
        style={{ color: "#344054", textDecoration: "underline" }}
        href={`mailto:${booking.organization.owner.email}`}
      >
        contact the owner
      </Link>{" "}
      of the workspace.
    </Text>
    <Text style={{ marginBottom: "32px", fontSize: "14px", color: "#344054" }}>
      {" "}
      © 2024 Shelf.nu
    </Text>
  </>
);

/** Footer used when sending admin user emails */
export const AdminFooter = ({ booking }: { booking: BookingForEmail }) => (
  <>
    <Text style={{ fontSize: "14px", color: "#344054" }}>
      This email was sent to you because you are the OWNER or ADMIN of the
      workspace{" "}
      <span style={{ color: "#101828", fontWeight: "600" }}>
        "{booking.organization.name}"
      </span>
      . <br /> If you think you weren’t supposed to have received this email
      please contact support.
    </Text>
    <Text style={{ marginBottom: "32px", fontSize: "14px", color: "#344054" }}>
      {" "}
      © 2024 Shelf.nu
    </Text>
  </>
);
