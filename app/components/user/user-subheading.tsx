import type { getUserWithContact } from "~/modules/user/service.server";
import { Button } from "../shared/button";

export function UserSubheading({
  user,
}: {
  user: ReturnType<typeof getUserWithContact>;
}) {
  const { contact } = user;
  const hasAnyContactInfo =
    [
      contact.street,
      contact.city,
      contact.stateProvince,
      contact.zipPostalCode,
      contact.countryRegion,
    ].filter(Boolean).length > 0;
  return (
    <div>
      <span>
        <Button variant="inherit" to={`mailto:${user.email}`}>
          {user.email}
        </Button>{" "}
        {contact?.phone && (
          <>
            &bull;{" "}
            <Button variant="inherit" to={`tel:${contact.phone}`}>
              {contact.phone}
            </Button>{" "}
          </>
        )}
        {hasAnyContactInfo && (
          <>
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
          </>
        )}
      </span>
    </div>
  );
}
