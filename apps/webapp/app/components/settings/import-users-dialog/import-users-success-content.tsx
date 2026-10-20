import { lazy, Suspense } from "react";
import { ClientOnly } from "remix-utils/client-only";
import { Button } from "~/components/shared/button";
import { WarningBox } from "~/components/shared/warning-box";
import When from "~/components/when/when";
import { tw } from "~/utils/tw";
import type { FetcherData } from "./import-users-dialog";
import ImportUsersTable from "./import-users-table";

const SuccessAnimation = lazy(
  () => import("~/components/scanner/success-animation")
);

type ImportUsersSuccessContentProps = {
  className?: string;
  data: FetcherData;
  onClose: () => void;
  onViewInvites: () => void;
};

export default function ImportUsersSuccessContent({
  className,
  data,
  onClose,
  onViewInvites,
}: ImportUsersSuccessContentProps) {
  return (
    <div
      className={tw(
        "flex flex-col items-center justify-center px-6 pb-4 text-center",
        className
      )}
    >
      <ClientOnly fallback={null}>
        {() => (
          <Suspense fallback={null}>
            <SuccessAnimation />
          </Suspense>
        )}
      </ClientOnly>

      <h4>Import completed</h4>
      <p className="mb-4">
        Users from the csv file has been invited. Below you can find a summary
        of the invited users.
      </p>

      <When truthy={!!data.extraMessage}>
        <WarningBox className="mb-4 w-full">
          {data.extraMessage ?? ""}
        </WarningBox>
      </When>

      <When truthy={!!data?.inviteSentUsers?.length}>
        <ImportUsersTable
          className="mb-4"
          title="Invited users"
          users={data?.inviteSentUsers ?? []}
        />
      </When>
      <When truthy={!!data?.skippedUsers?.length}>
        <ImportUsersTable
          className="mb-4"
          title="Skipped users"
          users={data?.skippedUsers ?? []}
        />
      </When>

      <div className="flex w-full items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          className="flex-1"
        >
          Close
        </Button>
        <Button type="button" onClick={onViewInvites} className="flex-1">
          View Invites
        </Button>
      </div>
    </div>
  );
}
