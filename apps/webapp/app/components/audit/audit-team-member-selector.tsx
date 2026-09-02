import type { CSSProperties } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { CheckIcon, UserIcon } from "lucide-react";
import { Button } from "~/components/shared/button";
import { Separator } from "~/components/shared/separator";
import When from "~/components/when/when";
import useApiQuery from "~/hooks/use-api-query";
import { useUserData } from "~/hooks/use-user-data";
import { AUDIT_ASSIGNEES_FIELD } from "~/modules/audit/assignee-form";
import type { AuditTeamMember } from "~/routes/api+/audits.team-members";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";

/** A team member the dialog wants pre-selected, with the user id it maps to. */
export type AuditAssigneeDefault = {
  /** TeamMember id (what the list renders and toggles on). */
  id: string;
  /** The member's user id (what the server stores on the assignment). */
  userId: string;
  name: string;
};

type AuditTeamMemberSelectorProps = {
  className?: string;
  style?: CSSProperties;
  error?: string;
  /**
   * Members to pre-select (edit dialog). Carries the user id so the hidden
   * inputs are complete before the member list has loaded — otherwise a save
   * during that window would submit an empty selection and remove everyone.
   */
  defaultSelected?: AuditAssigneeDefault[];
};

type KnownMember = { userId: string; name: string };

/**
 * Team member selector for audit assignment.
 *
 * Multi-select: every selected member becomes an assignee, and any assignee
 * may scan, annotate and complete the audit. Each selection is submitted as
 * its own bracket-indexed hidden input (`assignees[0]`, `assignees[1]`, …)
 * because the server's form parser collapses repeated same-name fields but
 * turns bracket indices into an array — the convention `assetIds[i]` uses.
 *
 * Only shows team members with user accounts (excludes NRMs).
 */
export default function AuditTeamMemberSelector({
  className,
  style,
  error,
  defaultSelected,
}: AuditTeamMemberSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  // Lazy initializer avoids a false-positive derived-state lint: after mount this
  // state is user-controlled via the selector, so it must NOT re-sync with the prop.
  const [selectedIds, setSelectedIds] = useState<string[]>(
    () => defaultSelected?.map((member) => member.id) ?? []
  );
  // Everything ever selected, keyed by team member id. Seeded from the
  // defaults and extended from the loaded list, so a hidden input can always
  // name the user id even when the search filter hides the row.
  const knownMembersRef = useRef<Map<string, KnownMember>>(
    new Map(
      (defaultSelected ?? []).map((member) => [
        member.id,
        { userId: member.userId, name: member.name },
      ])
    )
  );

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

  const remember = useCallback((teamMember: AuditTeamMember) => {
    knownMembersRef.current.set(teamMember.id, {
      userId: teamMember.user?.id ?? "",
      name: teamMember.name,
    });
  }, []);

  const handleTeamMemberSelect = useCallback(
    (teamMember: AuditTeamMember) => {
      remember(teamMember);
      setSelectedIds((prev) =>
        prev.includes(teamMember.id)
          ? prev.filter((id) => id !== teamMember.id)
          : [...prev, teamMember.id]
      );
    },
    [remember]
  );

  const isSelfSelected =
    !!currentUserTeamMember && selectedIds.includes(currentUserTeamMember.id);

  const handleAssignToSelf = useCallback(() => {
    if (currentUserTeamMember && !isSelfSelected) {
      handleTeamMemberSelect(currentUserTeamMember);
    }
  }, [currentUserTeamMember, isSelfSelected, handleTeamMemberSelect]);

  const teamMembers = useMemo(() => {
    if (!data) {
      return [];
    }

    if (!searchQuery) {
      return data.teamMembers;
    }

    const normalizedQuery = searchQuery.toLowerCase().trim();
    // `displayName` is matched alongside first/last name: it replaces them in
    // the row for users who set one, so it is the name a searcher can see.
    return data.teamMembers.filter(
      (tm) =>
        tm.name.toLowerCase().includes(normalizedQuery) ||
        tm.user?.firstName?.toLowerCase().includes(normalizedQuery) ||
        tm.user?.lastName?.toLowerCase().includes(normalizedQuery) ||
        tm.user?.displayName?.toLowerCase().includes(normalizedQuery) ||
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

      {currentUserTeamMember && (
        <div className="mx-3 mb-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={handleAssignToSelf}
            disabled={isSelfSelected}
          >
            {isSelfSelected ? "You are assigned" : "Assign to self"}
          </Button>
        </div>
      )}

      <When truthy={!!error}>
        <p className="px-3 pb-2 text-error-500">{error}</p>
      </When>

      <When truthy={selectedIds.length > 0}>
        <p className="px-3 pb-2 text-sm text-gray-600">
          {selectedIds.length === 1
            ? "1 assignee selected"
            : `${selectedIds.length} assignees selected`}
        </p>
      </When>

      <Separator />

      {/* One hidden input per selection, bracket-indexed so the server sees an array */}
      {selectedIds.map((id, index) => {
        const known = knownMembersRef.current.get(id);
        return (
          <input
            key={id}
            type="hidden"
            name={`${AUDIT_ASSIGNEES_FIELD}[${index}]`}
            value={JSON.stringify({
              id,
              name: known?.name ?? "",
              userId: known?.userId ?? "",
            })}
          />
        );
      })}

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
            const isTeamMemberSelected = selectedIds.includes(teamMember.id);

            return (
              <div
                key={teamMember.id}
                className={tw(
                  "flex cursor-pointer items-center justify-between gap-4 border-b px-6 py-4 hover:bg-gray-100",
                  isTeamMemberSelected && "bg-gray-100"
                )}
                role="checkbox"
                aria-checked={isTeamMemberSelected}
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
