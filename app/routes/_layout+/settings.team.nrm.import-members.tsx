import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { parseFormData } from "@remix-run/form-data-parser";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useFetcher } from "react-router";
import Input from "~/components/forms/input";
import { UserIcon } from "~/components/icons/library";
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
import { WarningBox } from "~/components/shared/warning-box";
import type { CreateAssetFromContentImportPayload } from "~/modules/asset/types";
import { createTeamMemberIfNotExists } from "~/modules/team-member/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanImportNRM } from "~/utils/subscription.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.create,
    });
    await assertUserCanImportNRM({ organizationId, organizations });

    return payload({
      showModal: true,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.create,
    });

    await assertUserCanImportNRM({ organizationId, organizations });

    // Files are automatically stored in memory with parseFormData
    const formData = await parseFormData(request);

    const csvFile = formData.get("file") as File;
    const text = await csvFile.text();
    const memberNames = text.split(",").map((name) => name.trim());

    // Transform member names into format expected by createTeamMemberIfNotExists
    const importData: CreateAssetFromContentImportPayload[] = memberNames.map(
      (name) => ({
        key: "", // Required by type but unused
        title: "", // Required by type but unused
        tags: [], // Required by type but unused
        custodian: name,
      })
    );

    await createTeamMemberIfNotExists({
      data: importData,
      organizationId,
    });

    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function ImportNRMs() {
  return (
    <>
      <div className="modal-content-wrapper">
        <div className="mb-4 inline-flex size-8 items-center justify-center  rounded-full bg-primary-100 p-2 text-primary-600">
          <UserIcon />
        </div>
        <div className="mb-5">
          <h4>Import team members</h4>
          <p>
            Team members just have 1 field and that is a name field. Importing
            team members just requires you to upload a txt file with member
            names separated by comas.
            <br />
            <ul className="list-inside list-disc pl-4">
              <li>Names which are already in the system will be ignored.</li>
              <li>Duplicates will be skipped.</li>
            </ul>
            <WarningBox className="my-2">
              Import is final and cannot be reverted. If you want to later edit
              team members, you can do so from the Team settings page.
            </WarningBox>
          </p>
        </div>
        <ImportForm />
      </div>
    </>
  );
}

function ImportForm() {
  const [agreed, setAgreed] = useState<"I AGREE" | "">("");
  const formRef = useRef<HTMLFormElement>(null);
  const fetcher = useFetcher<typeof action>();

  const { data, state } = fetcher;
  const disabled = isFormProcessing(state) || agreed !== "I AGREE";
  const isSuccessful = data && !data.error && data.success;

  /** We use a controlled field for the file, because of the confirmation dialog we have.
   * That way we can disabled the confirmation dialog button until a file is selected
   */
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event?.target?.files?.[0];
    if (selectedFile) {
      setSelectedFile(selectedFile);
    }
  };
  return (
    <fetcher.Form
      className="mt-4"
      method="post"
      ref={formRef}
      encType="multipart/form-data"
    >
      <Input
        type="file"
        name="file"
        label="Select a txt file"
        required
        onChange={handleFileSelect}
        accept=".txt"
      />

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            title={"Confirm NRM import"}
            disabled={!selectedFile}
            className="mt-4 w-full"
          >
            Confirm Non-registered members import
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Confirm Non-registered members import
            </AlertDialogTitle>
            {!isSuccessful ? (
              <>
                <AlertDialogDescription>
                  You need to type: <b>"I AGREE"</b> in the field below to
                  accept the import. By doing this you agree that you have read
                  the requirements and you understand the limitations and
                  consequences of using this feature.
                </AlertDialogDescription>
                <Input
                  type="text"
                  label={"Confirmation"}
                  name="agree"
                  value={agreed}
                  onChange={(e) => setAgreed(e.target.value as any)}
                  placeholder="I AGREE"
                  pattern="^I AGREE$" // We use a regex to make sure the user types the exact string
                  required
                />
              </>
            ) : null}
          </AlertDialogHeader>
          {data?.error ? (
            <div>
              <b className="text-red-500">{data.error.message}</b>
              <p>
                Please fix your txt file and try again. If the issue persists,
                don't hesitate to get in touch with us.
              </p>
            </div>
          ) : null}

          {isSuccessful ? (
            <div>
              <b className="text-green-500">Success!</b>
              <p>Your Non-registered members have been imported.</p>
            </div>
          ) : null}

          <AlertDialogFooter>
            {isSuccessful ? (
              <Button to="/settings/team/nrm" variant="secondary">
                Close
              </Button>
            ) : (
              <>
                <AlertDialogCancel asChild>
                  <Button variant="secondary">Cancel</Button>
                </AlertDialogCancel>
                <Button
                  type="submit"
                  onClick={() => {
                    // Because we use a Dialog the submit buttons is outside of the form so we submit using the fetcher directly
                    void fetcher.submit(formRef.current);
                  }}
                  disabled={disabled}
                >
                  {isFormProcessing(fetcher.state) ? "Importing..." : "Import"}
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </fetcher.Form>
  );
}
