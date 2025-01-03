import type { Prisma } from "@prisma/client";
import { CheckIcon, UserIcon } from "lucide-react";
import { Separator } from "~/components/shared/separator";
import When from "~/components/when/when";
import { useModelFilters } from "~/hooks/use-model-filters";
import { tw } from "~/utils/tw";

type TeamMembersSelectorProps = {
  className?: string;
  style?: React.CSSProperties;
  error?: string;
  defaultValues?: string[];
};

export default function TeamMembersSelector({
  className,
  style,
  error,
  defaultValues,
}: TeamMembersSelectorProps) {
  const {
    items,
    handleSearchQueryChange,
    searchQuery,
    handleSelectItemChange,
    selectedItems,
  } = useModelFilters({
    selectionMode: "none",
    defaultValues,
    model: {
      name: "teamMember",
      queryKey: "name",
      deletedAt: null,
      userWithAdminAndOwnerOnly: true,
    },
    countKey: "totalTeamMembers",
    initialDataKey: "teamMembers",
  });

  return (
    <div
      className={tw("overflow-auto md:max-h-[470px]", className)}
      style={style}
    >
      <div className="m-3 flex items-center gap-2 rounded border px-3 py-2">
        <UserIcon className="size-4 text-gray-500" />
        <input
          type="text"
          placeholder="Find team members"
          className="flex-1 border-none p-0 focus:border-none focus:ring-0"
          value={searchQuery}
          onChange={handleSearchQueryChange}
        />
      </div>
      <When truthy={!!error}>
        <p className="px-3 pb-2 text-error-500">{error}</p>
      </When>

      <Separator />

      {selectedItems.map((item, i) => (
        <input
          key={item}
          type="hidden"
          name={`teamMembers[${i}]`}
          value={item}
        />
      ))}

      {items.map((item) => {
        const teamMember = item as unknown as Prisma.TeamMemberGetPayload<{
          include: { user: { select: { profilePicture: true } } };
        }>;
        const isTeamMemberSelected = selectedItems.includes(teamMember.id);

        return (
          <div
            key={teamMember.id}
            className={tw(
              "flex cursor-pointer items-center justify-between gap-4 border-b px-6 py-4 hover:bg-gray-100",
              isTeamMemberSelected && "bg-gray-100"
            )}
            onClick={() => {
              handleSelectItemChange(teamMember.id);
            }}
          >
            <div className="flex items-center gap-2">
              <img
                className="size-6 rounded-sm"
                alt={`${teamMember.name}'s img`}
                src={
                  teamMember.user?.profilePicture ??
                  "/static/images/default_pfp.jpg"
                }
              />
              <p className="font-medium">{teamMember.name}</p>
            </div>

            <When truthy={isTeamMemberSelected}>
              <CheckIcon className="size-4 text-primary" />
            </When>
          </div>
        );
      })}
    </div>
  );
}
