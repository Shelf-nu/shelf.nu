import type { getUserWithContact } from "~/modules/user/service.server";
import { Button } from "../shared/button";

export function UserSubheading({
  user,
}: {
  user: ReturnType<typeof getUserWithContact>;
}) {
  const { contact } = user;
  return (
    <div>
      <span>
        <Button variant="inherit" to={`mailto:${user.email}`}>
          {user.email}
        </Button>{" "}
        &bull;{" "}
        <Button variant="inherit" to={`tel:${contact.phone}`}>
          {contact.phone}
        </Button>{" "}
        &bull;{" "}
        {[
          contact.street,
          contact.city,
          contact.stateProvince,
          contact.zipPostalCode,
          contact.countryRegion,
        ]
          .filter(Boolean)
          .join(", ") || "No address provided"}
      </span>
    </div>
  );
}
