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
    {/*
      Empty alt text is intentional: The profile picture is decorative as the user's
      name is displayed immediately adjacent to the image. Per WCAG guidelines,
      decorative images should have empty alt attributes to prevent redundant
      screen reader announcements (e.g., "John Doe profile picture" followed by "John Doe").
    */}
    <img
      className={tw("mr-1 size-4 rounded-full", imgClassName)}
      src={img || "/static/images/default_pfp.jpg"}
      alt=""
    />
    <span className="mt-px">{name}</span>
  </span>
);
