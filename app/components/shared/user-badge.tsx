import { GrayBadge } from "./gray-badge";

export function UserBadge({
  img,
  name,
}: {
  img?: string | null;
  name: string;
}) {
  return (
    <GrayBadge>
      <img
        src={img || "/static/images/default_pfp.jpg"}
        className="mr-1 size-4 rounded-full"
        alt={name}
      />
      <span className="mt-px">{name}</span>
    </GrayBadge>
  );
}
