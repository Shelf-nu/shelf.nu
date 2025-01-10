import { useMemo, useState } from "react";
import { CheckIcon, UserIcon } from "lucide-react";
import { Separator } from "~/components/shared/separator";
import When from "~/components/when/when";
import useApiQuery from "~/hooks/use-api-query";
import type { ReminderTeamMember } from "~/routes/api+/reminders.team-members";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTeamMembers, setSelectedTeamMembers] = useState<string[]>(
    defaultValues?.length ? defaultValues : []
  );

  const { isLoading, data } = useApiQuery<{
    teamMembers: ReminderTeamMember[];
  }>({
    api: "/api/reminders/team-members",
  });

  const teamMembers = useMemo(() => {
    if (!data) {
      return [];
    }

    if (!searchQuery) {
      return data.teamMembers;
    }

    const normalizedQuery = searchQuery.toLowerCase().trim();
    return data.teamMembers.filter(
      (tm) =>
        tm.name.toLowerCase().includes(normalizedQuery) ||
        tm.user?.firstName?.toLowerCase().includes(normalizedQuery) ||
        tm.user?.lastName?.toLowerCase().includes(normalizedQuery) ||
        tm.user?.email?.includes(normalizedQuery)
    );
  }, [data, searchQuery]);

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
          onChange={(event) => {
            setSearchQuery(event.target.value);
          }}
        />
      </div>
      <When truthy={!!error}>
        <p className="px-3 pb-2 text-error-500">{error}</p>
      </When>

      <Separator />

      {selectedTeamMembers.map((item, i) => (
        <input
          key={item}
          type="hidden"
          name={`teamMembers[${i}]`}
          value={item}
        />
      ))}

      <When truthy={isLoading}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="mb-1 h-14 w-full animate-pulse bg-gray-100" />
        ))}
      </When>

      <When truthy={!isLoading}>
        {teamMembers.map((teamMember) => {
          const isTeamMemberSelected = selectedTeamMembers.includes(
            teamMember.id
          );

          return (
            <div
              key={teamMember.id}
              className={tw(
                "flex cursor-pointer items-center justify-between gap-4 border-b px-6 py-4 hover:bg-gray-100",
                isTeamMemberSelected && "bg-gray-100"
              )}
              onClick={() => {
                setSelectedTeamMembers((prev) => {
                  if (prev.includes(teamMember.id)) {
                    return prev.filter((tm) => tm !== teamMember.id);
                  }
                  return [...prev, teamMember.id];
                });
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
                <p className="font-medium">
                  {resolveTeamMemberName(teamMember, true)}
                </p>
              </div>

              <When truthy={isTeamMemberSelected}>
                <CheckIcon className="size-4 text-primary" />
              </When>
            </div>
          );
        })}
      </When>
    </div>
  );
}
