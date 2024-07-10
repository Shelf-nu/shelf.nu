import { json } from "@remix-run/node";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";

import { ErrorContent } from "~/components/errors";
import { LinkIcon } from "~/components/icons/library";

import { Button } from "~/components/shared/button";

import { db } from "~/database/db.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";

export const loader = async ({ context, params }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { qrId } = getParams(params, z.object({ qrId: z.string() }));

  try {
    const qr = await db.qr
      .findUniqueOrThrow({
        where: { id: qrId },
        select: {
          asset: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "The QR you are trying to access does not exist.",
          title: "QR not found",
          label: "QR",
          status: 404,
        });
      });

    return json(
      data({
        header: {
          title: "Successfully linked asset to QR code",
        },
        asset: qr.asset,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, qrId });
    throw json(error(reason));
  }
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export default function QrSuccessfullLink() {
  const { asset } = useLoaderData<typeof loader>();
  return asset ? (
    <>
      <div className="flex max-h-full flex-1 flex-col items-center justify-center ">
        <span className="mb-2.5 flex size-12 items-center justify-center rounded-full bg-success-50 p-2 text-success-600">
          <LinkIcon />
        </span>
        <h3>Succesfully linked Item</h3>
        <p>
          Your asset <b>{asset.title}</b> has been linked with this QR code.
        </p>
        <div className="mt-8 flex w-full flex-col gap-3">
          <Button
            to={`/assets/${asset.id}`}
            width="full"
            variant="secondary"
            data-test-id="viewAssetButton"
          >
            View asset
          </Button>
          <Button to={`/scanner`} width="full">
            Go to scanner
          </Button>
        </div>
      </div>
    </>
  ) : null;
}

export const ErrorBoundary = () => <ErrorContent />;
