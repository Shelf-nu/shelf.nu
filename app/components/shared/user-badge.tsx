export const UserBadge = ({
  img,
  name,
}: {
  img: string | null;
  name: string;
}) => (
  <div className="max-w-[250px]">
    <span className="mb-1 ml-1 inline-flex w-max items-center rounded-2xl bg-gray-100 px-2 py-0.5">
      {img && <img className="h-4 w-4" src={img} alt={name} />}
      <span className="ml-1.5 text-[12px] font-medium text-gray-700">
        {name}
      </span>
    </span>
  </div>
);
