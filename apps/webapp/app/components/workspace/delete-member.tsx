import { useMemo } from "react";
import type { Prisma, TeamMember } from "@prisma/client";
import { useNavigation } from "react-router";
import { Button } from "~/components/shared/button";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";

import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { Form } from "../custom-form";
import { TrashIcon, XIcon } from "../icons/library";

export const DeleteMember = ({
  teamMember,
}: {
  teamMember: Prisma.TeamMemberGetPayload<{
    include: {
      _count: {
        select: {
          custodies: true;
        };
      };
    };
  }>;
}) => {
  const hasCustodies = useMemo(
    () => teamMember?._count.custodies > 0,
    [teamMember]
  );
  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="link"
            data-test-id="deleteTeamMemberButton"
            className="justify-start rounded-sm  p-3 text-sm font-semibold text-color-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-color-50 hover:text-color-700"
            width="full"
          >
            <span className="flex items-center gap-2">
              <TrashIcon />
              Delete
            </span>
          </Button>
        </AlertDialogTrigger>

        {hasCustodies ? (
          <UnableToDeleteMemberContent
            custodiesCount={teamMember?._count.custodies}
          />
        ) : (
          <DeleteMemberContent id={teamMember.id} />
        )}
      </AlertDialog>
    </>
  );
};

const DeleteMemberContent = ({ id }: { id: TeamMember["id"] }) => {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  return (
    <AlertDialogContent className="relative">
      <AlertDialogHeader className="mb-8">
        <AlertDialogTitle>Delete team member</AlertDialogTitle>
        <AlertDialogDescription>
          After deleting a team member you will no longer be able to give them
          custody over an asset.
        </AlertDialogDescription>
        <AlertDialogCancel
          asChild
          className="absolute right-5 top-5 cursor-pointer"
        >
          <XIcon />
        </AlertDialogCancel>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <Form method="post" className="w-full">
          <input type="hidden" name="teamMemberId" value={id} />
          <Button
            className={tw(
              "border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800",
              disabled ? "pointer-events-none opacity-50" : ""
            )}
            type="submit"
            width="full"
            data-test-id="confirmdeleteAssetButton"
            disabled={disabled}
            name="intent"
            value="delete"
          >
            Delete team member
          </Button>
        </Form>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
};

const UnableToDeleteMemberContent = ({
  custodiesCount,
}: {
  custodiesCount: number;
}) => (
  <AlertDialogContent className="relative">
    <AlertDialogHeader className="mb-8">
      <AlertDialogTitle>Unable to delete team member</AlertDialogTitle>
      <AlertDialogDescription>
        The team member you are trying to delete has custody over{" "}
        {custodiesCount} assets. Please release custody or check-in those assets
        before deleting the user.
      </AlertDialogDescription>
      <AlertDialogCancel
        asChild
        className="absolute right-5 top-5 cursor-pointer"
      >
        <XIcon />
      </AlertDialogCancel>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel asChild>
        <Button variant="secondary" width="full">
          Close
        </Button>
      </AlertDialogCancel>
    </AlertDialogFooter>
  </AlertDialogContent>
);
