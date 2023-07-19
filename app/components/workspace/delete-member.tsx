import { useState } from "react";
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
import { XIcon } from "../icons";

export const DeleteMember = () => {
  const isMemberCustodian = true;
  const [showDeleteErrorModal, setShowDeleteErrorModal] = useState(false);
  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="link"
            data-test-id="deleteAssetButton"
            className="justify-start rounded-sm px-6 py-3 text-sm font-semibold text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700"
            width="full"
          >
            Delete
          </Button>
        </AlertDialogTrigger>

        <AlertDialogContent className="relative">
          <AlertDialogHeader className="mb-8">
            <AlertDialogTitle>Delete team member</AlertDialogTitle>
            <AlertDialogDescription>
              After deleting a team member you will no longer be able to give
              them custody over an asset.
            </AlertDialogDescription>
            <AlertDialogCancel
              asChild
              className="absolute right-5 top-5 cursor-pointer"
            >
              <XIcon />
            </AlertDialogCancel>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
              type="submit"
              width="full"
              data-test-id="confirmdeleteAssetButton"
              onClick={() =>
                isMemberCustodian
                  ? setShowDeleteErrorModal(true)
                  : setShowDeleteErrorModal(false)
              }
            >
              Delete team member
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteErrorModal}>
        <AlertDialogContent className="relative">
          <AlertDialogHeader className="mb-8">
            <AlertDialogTitle>Unable to delete team member</AlertDialogTitle>
            <AlertDialogDescription>
              The team member you are trying to delete has custody over 1 or
              more assets. Please release custody before deleting the user.
            </AlertDialogDescription>
            <button
              className="absolute right-5 top-5 cursor-pointer"
              onClick={() => setShowDeleteErrorModal(false)}
            >
              <XIcon />
            </button>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="secondary"
              width="full"
              onClick={() => setShowDeleteErrorModal(false)}
            >
              Close
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
