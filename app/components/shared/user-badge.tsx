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
  <div className="h-6 max-w-[250px]">
    <span
      className={tw(
        "ml-1 inline-flex w-max items-center rounded-2xl bg-gray-100 px-2 py-0.5",
        className
      )}
    >
      {img && (
        <img className={tw("size-4", imgClassName)} src={img} alt={name} />
      )}
      <span className="ml-1.5 text-[12px] font-medium text-gray-700">
        {name}
      </span>
    </span>
  </div>
);
