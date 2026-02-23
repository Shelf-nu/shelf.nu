import { useUserData } from "~/hooks/use-user-data";
import { tw } from "~/utils/tw";

/** Returns the current user's profile picture */
export default function ProfilePicture({
  width = "w-16",
  height = "h-16",
  className = "",
}: {
  /** Tailwind class for width */
  width?: string;
  /** Tailwind class for height */
  height?: string;

  /** Extra classes */
  className?: string;
}) {
  const user = useUserData();
  const styles = tw(width, height, "rounded-[4px]", className);

  return user ? (
    <img
      src={user.profilePicture || "/static/images/default_pfp.jpg"}
      alt={`${user.username}`}
      className={styles}
    />
  ) : null;
}
