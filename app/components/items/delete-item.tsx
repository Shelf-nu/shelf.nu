import type { Item } from "@prisma/client";
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
import { TrashIcon } from "../icons";

export const DeleteItem = ({
  item,
}: {
  item: {
    title: Item["title"];
    mainImage: Item["mainImage"];
  };
}) => (
  <AlertDialog>
    <div>
      <AlertDialogTrigger asChild>
        <Button variant="secondary" data-test-id="deleteItemButton">
          Delete
        </Button>
      </AlertDialogTrigger>
    </div>

    <AlertDialogContent>
      <AlertDialogHeader>
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
          <TrashIcon />
        </span>
        <AlertDialogTitle>Delete {item.title}</AlertDialogTitle>
        <AlertDialogDescription>
          Are you sure you want to delete this asset? This action cannot be
          undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel asChild>
          <Button variant="secondary">Cancel</Button>
        </AlertDialogCancel>

        <Form method="delete">
          {item.mainImage && (
            <input type="hidden" value={item.mainImage} name="mainImage" />
          )}

          <Button
            className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
            type="submit"
            data-test-id="confirmDeleteItemButton"
          >
            Delete
          </Button>
        </Form>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
