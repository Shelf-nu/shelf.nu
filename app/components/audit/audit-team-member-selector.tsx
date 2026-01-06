import type { CSSProperties } from "react";
import { useCallback, useMemo, useState } from "react";
import { CheckIcon, UserIcon } from "lucide-react";
import { Button } from "~/components/shared/button";
import { Separator } from "~/components/shared/separator";
import When from "~/components/when/when";
import useApiQuery from "~/hooks/use-api-query";
import { useUserData } from "~/hooks/use-user-data";
import type { AuditTeamMember } from "~/routes/api+/audits.team-members";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";

type AuditTeamMemberSelectorProps = {
  className?: string;
  style?: CSSProperties;
  error?: string;
  defaultValue?: string;
};

/**
 * Team member selector for audit assignment.
 * Single selection mode - only one assignee can be chosen.
 * Only shows team members with user accounts (excludes NRMs).
 */
export default function AuditTeamMemberSelector({
  className,
  style,
  error,
  defaultValue,
}: AuditTeamMemberSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTeamMember, setSelectedTeamMember] = useState<
    string | undefined
  >(defaultValue);

  const user = useUserData();

  const { isLoading, data } = useApiQuery<{
    teamMembers: AuditTeamMember[];
  }>({
    api: "/api/audits/team-members",
  });

  const currentUserTeamMember = useMemo(() => {
    if (!data || !user?.id) return undefined;
    return data.teamMembers.find((tm) => tm.user?.id === user.id);
  }, [data, user?.id]);

  const handleAssignToSelf = useCallback(() => {
    if (currentUserTeamMember) {
      setSelectedTeamMember(currentUserTeamMember.id);
    }
  }, [currentUserTeamMember]);

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

  const handleTeamMemberSelect = useCallback((teamMember: AuditTeamMember) => {
    setSelectedTeamMember((prev) => {
      // Toggle selection: if already selected, deselect
      if (prev === teamMember.id) {
        return undefined;
      }
      return teamMember.id;
    });
  }, []);

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

      {currentUserTeamMember && (
        <div className="mx-3 mb-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={handleAssignToSelf}
            disabled={selectedTeamMember === currentUserTeamMember.id}
          >
            {selectedTeamMember === currentUserTeamMember.id
              ? "Assigned to self"
              : "Assign to self"}
          </Button>
        </div>
      )}

      <When truthy={!!error}>
        <p className="px-3 pb-2 text-error-500">{error}</p>
      </When>

      <Separator />

      {/* Hidden input field for form submission */}
      {selectedTeamMember && (
        <input
          type="hidden"
          name="assignee"
          value={JSON.stringify({
            id: selectedTeamMember,
            name:
              teamMembers.find((tm) => tm.id === selectedTeamMember)?.name ??
              "",
            userId:
              teamMembers.find((tm) => tm.id === selectedTeamMember)?.user
                ?.id ?? "",
          })}
        />
      )}

      <When truthy={isLoading}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="mb-1 h-14 w-full animate-pulse bg-gray-100" />
        ))}
      </When>

      <When truthy={!isLoading}>
        {teamMembers.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">
            No team members available
          </div>
        ) : (
          teamMembers.map((teamMember) => {
            const isTeamMemberSelected = selectedTeamMember === teamMember.id;

            return (
              <div
                key={teamMember.id}
                className={tw(
                  "flex cursor-pointer items-center justify-between gap-4 border-b px-6 py-4 hover:bg-gray-100",
                  isTeamMemberSelected && "bg-gray-100"
                )}
                role="button"
                tabIndex={0}
                onClick={() => handleTeamMemberSelect(teamMember)}
                onKeyDown={handleActivationKeyPress(() =>
                  handleTeamMemberSelect(teamMember)
                )}
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
          })
        )}
      </When>
    </div>
  );
}
