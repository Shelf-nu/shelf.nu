import { tw } from "~/utils/tw";

type UserBadgeProps = {
  className?: string;
  img?: string | null;
  imgClassName?: string;
  name: string;
};

export const UserBadge = ({
  className,
  img,
  imgClassName,
  name,
}: UserBadgeProps) => (
  <span
    className={tw(
      "inline-flex w-max items-center justify-center rounded-2xl bg-gray-100 px-2 py-[2px] text-center text-[12px] font-medium text-gray-700",
      className
    )}
  >
    <img
      className={tw("mr-1 size-4 rounded-full", imgClassName)}
      src={img || "/static/images/default_pfp.jpg"}
      alt={name}
    />
    <span className="mt-px">{name}</span>
  </span>
);
