/**
 * User Subheading
 *
 * The line under a person's name on a profile page: email, phone and address.
 * Used by the team member profile and by "My profile".
 *
 * @see {@link file://../../routes/_layout+/settings.team.users.$userId.tsx}
 * @see {@link file://../../routes/_layout+/me.tsx}
 */
import type { UserContactForDisplay } from "~/modules/user-contact/service.server";
import { Button } from "../shared/button";

/**
 * Renders a user's email and whatever contact details are stored.
 *
 * @param props.user - The user's email and contact fields (`null` where unset)
 */
export function UserSubheading({
  user,
}: {
  user: { email: string; contact: UserContactForDisplay };
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
