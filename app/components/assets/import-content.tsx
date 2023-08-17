import { useRef, useState } from "react";
import type { FetcherWithComponents } from "@remix-run/react";
import { useFetcher } from "@remix-run/react";
import Input from "../forms/input";
import { Button } from "../shared";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../shared/modal";

export const ImportBackup = () => {
  const fetcher = useFetcher();
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <>
      <h3>Import from backup</h3>
      <p>
        This option allows you to import assets that have been exported from
        shelf. It can be used to restore a backup or move assets from one
        account to another.
      </p>
      <br />
      <p>This feature comes with some important limitations:</p>
      <ul className="list-inside list-disc">
        <li>Assets will be imported with all their relationships</li>
        <li>
          Assets will not be merged with existing ones. A asset with a new ID
          will be created for each one
        </li>
        <li>
          If you have modified the exported file, there is the possibility of
          the import failing due to broken data
        </li>
        <li>
          <b>IMPORTANT:</b> The first row of the sheet will be ignored. Use it
          to describe the columns.
        </li>
      </ul>

      <fetcher.Form className="mt-4" method="post" ref={formRef}>
        <Input
          type="file"
          name="backupFile"
          label="Select a csv file"
          required
        />
        <input type="hidden" name="intent" value="backup" />

        <ConfirmDialog formRef={formRef} fetcher={fetcher} />
      </fetcher.Form>
    </>
  );
};

export const ImportContent = () => {
  const formRef = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState("");
  const fetcher = useFetcher();

  return (
    <>
      <h3>Import your own content</h3>
      <p>
        Import your own content by placing it in the csv file. Here you can{" "}
        <Button variant="link" to="#">
          download our CSV template.
        </Button>
        Some important details about how this works:
      </p>
      <br />
      <ul className="list-inside list-disc">
        <li>Each row represents a new asset that will be created</li>
        <li>
          Columns such as <b>category, location & custodian</b> represent just
          the name of the related entry. As an example, if you put the category{" "}
          <b>Laptops</b> we will look for an existing category with that name
          and link the asset to it. If it doesn't exist, we will create it.
        </li>
        <li>
          Columns such as <b>tags</b> represent the names of a collection of
          entries. To assign multiple tags, just seperate their names with
          comas. If the tag doesn't exist, we will create it.
        </li>
        <li>
          The content you are importing will <b>NOT</b> be merged with existing
          assets. A new asset will be created for each valid row in the sheet.
        </li>
        <li>
          <b>IMPORTANT:</b> The first row of the sheet will be ignored. Use it
          to describe the columns.
        </li>
        <li>
          If any of the data in the file is invalid, the whole import will fail
        </li>
      </ul>
      <fetcher.Form className="mt-4" method="post" ref={formRef}>
        <Input
          type="file"
          name="contentFile"
          label="Select a csv file"
          required
          value={file}
          // onChange={(e) => {
          //   const file = e.currentTarget.files?.[0];
          //   if (file) {
          //     setFile(file.name);
          //   }
          // }}
        />
        <input type="hidden" name="intent" value="content" />
        <ConfirmDialog
          formRef={formRef}
          fetcher={fetcher}
          disabled={file === ""}
        />
      </fetcher.Form>
    </>
  );
};

const ConfirmDialog = ({
  formRef,
  fetcher,
  disabled = false,
}: {
  formRef: React.RefObject<HTMLFormElement>;
  fetcher: FetcherWithComponents<any>;
  disabled?: boolean;
}) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button title={"Confirm asset import"} disabled={disabled}>
        Confirm asset import
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Confirm asset import</AlertDialogTitle>
        <AlertDialogDescription>
          By clicking import you agree that you have read the requirements and
          you understand the limitations and consiquences of using this feature.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel asChild>
          <Button variant="secondary">Cancel</Button>
        </AlertDialogCancel>
        <Button
          type="submit"
          onClick={() => {
            fetcher.submit(formRef.current);
          }}
        >
          Import
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
