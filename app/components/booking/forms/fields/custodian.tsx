import type { SerializeFrom } from "@remix-run/node";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import type { ModelFilterItem } from "~/hooks/use-model-filters";
import type { NewBookingLoaderReturnType } from "~/routes/_layout+/bookings.new";
import { resolveTeamMemberName } from "~/utils/user";

// Add these utility types to extract the data
export type LoaderData<T extends (...args: any) => any> = Awaited<
  ReturnType<T>
> extends Response
  ? Awaited<ReturnType<Awaited<ReturnType<T>>["json"]>>
  : never;

// Now you can use it to get the team member type
export type TeamMemberType = SerializeFrom<
  LoaderData<NewBookingLoaderReturnType>["teamMembers"][number]
>;

export function CustodianField({
  defaultTeamMember,
  disabled,
  userCanSeeCustodian,
  isNewBooking,
  error,
}: {
  defaultTeamMember: TeamMemberType | undefined;
  disabled: boolean;
  userCanSeeCustodian: boolean;
  isNewBooking?: boolean;
  error?: string;
}) {
  return (
    <>
      <label className="mb-2.5 block font-medium text-gray-700">
        <span className="required-input-label">Custodian</span>
      </label>
      <DynamicSelect
        defaultValue={
          defaultTeamMember
            ? JSON.stringify({
                id: defaultTeamMember?.id,
                name: resolveTeamMemberName(defaultTeamMember),
                userId: defaultTeamMember?.userId,
              })
            : undefined
        }
        disabled={disabled}
        model={{
          name: "teamMember",
          queryKey: "name",
          deletedAt: null,
        }}
        fieldName="custodian"
        contentLabel="Team members"
        initialDataKey="teamMembers"
        countKey="totalTeamMembers"
        placeholder="Select a team member"
        allowClear
        closeOnSelect
        transformItem={(item: ModelFilterItem & { userId?: string }) => ({
          ...item,
          id: JSON.stringify({
            id: item.id,
            //If there is a user, we use its name, otherwise we use the name of the team member
            name: resolveTeamMemberName(item),
            userId: item?.userId,
          }),
        })}
        renderItem={(item) =>
          userCanSeeCustodian || isNewBooking
            ? resolveTeamMemberName(item, true)
            : "Private"
        }
      />

      {error ? <div className="text-sm text-error-500">{error}</div> : null}
      <p className="mt-2 text-[14px] text-gray-600">
        The person that will be in custody of or responsible for the assets
        during the duration of the booking period.
      </p>
    </>
  );
}
