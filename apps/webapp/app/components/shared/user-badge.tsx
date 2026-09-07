import { tw } from "~/utils/tw";
import type { UserNameFields } from "~/utils/user";
import { resolveUserDisplayName } from "~/utils/user";

/** The user shape the badge can name and picture on its own. */
type UserForBadge = UserNameFields & { profilePicture?: string | null };

type UserBadgeProps = {
  className?: string;
  img?: string | null;
  imgClassName?: string;
} & (
  | {
      /**
       * The user to render. Preferred over `name`: the badge resolves the
       * display name itself, so a call site cannot hand it a name built the
       * wrong way.
       */
      user: UserForBadge | null | undefined;
      name?: never;
    }
  | {
      /**
       * A name already resolved upstream. For rows that carry a flattened
       * name rather than a user relation — note feeds, for instance, where the
       * server resolved it while building the entry.
       */
      name: string;
      user?: never;
    }
);

/**
 * A chip naming one user, with their avatar.
 *
 * @param props.user - The user to name; the badge resolves `displayName` first
 * @param props.name - A pre-resolved name, for rows with no user relation
 * @param props.img - Avatar override; defaults to `user.profilePicture`
 */
export const UserBadge = ({
  className,
  img,
  imgClassName,
  name,
  user,
}: UserBadgeProps) => (
  <span
    className={tw(
      "inline-flex w-max items-center justify-center rounded-2xl bg-gray-100 px-2 py-[2px] text-center text-[12px] font-medium text-gray-700",
      className
    )}
  >
    {/*
      Empty alt text is intentional: The profile picture is decorative as the user's
      name is displayed immediately adjacent to the image. Per WCAG guidelines,
      decorative images should have empty alt attributes to prevent redundant
      screen reader announcements (e.g., "John Doe profile picture" followed by "John Doe").
    */}
    <img
      className={tw("mr-1 size-4 rounded-full", imgClassName)}
      src={img || user?.profilePicture || "/static/images/default_pfp.jpg"}
      alt=""
    />
    <span className="mt-px">{user ? resolveUserDisplayName(user) : name}</span>
  </span>
);
