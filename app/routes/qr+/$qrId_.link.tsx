import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { UnlinkIcon } from "~/components/icons";
import { Button } from "~/components/shared";
import { requireAuthSession } from "~/modules/auth";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireAuthSession(request);
  const { qrId } = params;
  return json({ qrId });
};

export default function QrLink() {
  const { qrId } = useLoaderData<typeof loader>();
  return (
    <>
      <div className="flex flex-1 justify-center py-8">
        <div className="my-auto">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary">
            <UnlinkIcon />
          </div>
          <div className="mb-8">
            <h1 className="mb-2 text-[24px] font-semibold">Unlinked QR Code</h1>
            <p className="text-gray-600">
              This code is part of your Shelf environment but is not linked with
              an asset. Would you like to link it?
            </p>
          </div>
          <div className="flex flex-col justify-center">
            <Button
              variant="primary"
              className="mb-4 max-w-full"
              to={`/assets/new?qrId=${qrId}`}
            >
              Create a new asset and link
            </Button>
            <Button variant="secondary" className="max-w-full" to={"/"}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
