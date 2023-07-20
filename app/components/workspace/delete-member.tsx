import { useMemo } from "react";
import type { TeamMember } from "@prisma/client";
import { Form } from "@remix-run/react";
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
import type { TeamMemberWithCustodies } from "~/routes/_layout+/settings.workspace";
import { XIcon } from "../icons";

export const DeleteMember = ({
  teamMember,
}: {
  teamMember: TeamMemberWithCustodies;
}) => {
  const hasCustodies = useMemo(
    () => teamMember.custodies.length > 0,
    [teamMember.custodies]
  );
  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="link"
            data-test-id="deleteTeamMemberButton"
            className="justify-start rounded-sm px-6 py-3 text-sm font-semibold text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700"
            width="full"
          >
            Delete
          </Button>
        </AlertDialogTrigger>

        {hasCustodies ? (
          <UnableToDeleteMemberContent />
        ) : (
          <DeleteMemberContent id={teamMember.id} />
        )}
      </AlertDialog>
    </>
  );
};

const DeleteMemberContent = ({ id }: { id: TeamMember["id"] }) => (
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
      <Form method="post">
        <input type="hidden" name="teamMemberId" value={id} />
        <Button
          className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
          type="submit"
          width="full"
          data-test-id="confirmdeleteAssetButton"
        >
          Delete team member
        </Button>
      </Form>
    </AlertDialogFooter>
  </AlertDialogContent>
);

const UnableToDeleteMemberContent = () => (
  <AlertDialogContent className="relative">
    <AlertDialogHeader className="mb-8">
      <AlertDialogTitle>Unable to delete team member</AlertDialogTitle>
      <AlertDialogDescription>
        The team member you are trying to delete has custody over 1 or more
        assets. Please release custody before deleting the user.
      </AlertDialogDescription>
      <button className="absolute right-5 top-5 cursor-pointer">
        <XIcon />
      </button>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <Button variant="secondary" width="full">
        Close
      </Button>
    </AlertDialogFooter>
  </AlertDialogContent>
);
