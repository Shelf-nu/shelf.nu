import type { Asset } from "@prisma/client";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { SuccessIcon } from "~/components/icons";
import { Button } from "~/components/shared/button";
import { db } from "~/database";
import { usePosition } from "~/hooks";
import { getAsset } from "~/modules/asset";
import { createReport, sendReportEmails } from "~/modules/report-found";
import { getUserByID } from "~/modules/user";
import {
  assertIsPost,
  data,
  error,
  getParams,
  isFormProcessing,
  parseData,
  tw,
} from "~/utils";
import { ShelfError, makeShelfError } from "~/utils/error";

export const NewReportSchema = z.object({
  email: z
    .string()
    .email("Please enter a valid Email address")
    .transform((email) => email.toLowerCase()),
  content: z.string().min(3, "Content is required"),
});

export async function action({ request, params }: ActionFunctionArgs) {
  const { qrId } = getParams(params, z.object({ qrId: z.string() }));

  try {
    assertIsPost(request);

    /** Query the QR and include the asset and userId for later use */
    const qr = await db.qr
      .findFirst({
        where: {
          id: qrId,
        },
        select: {
          asset: true,
          userId: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while fetching the QR. Please try again or contact support.",
          additionalData: { qrId },
          label: "QR",
        });
      });

    if (!qr || !qr.asset || !qr.asset.id) {
      throw new ShelfError({
        cause: null,
        message: "QR code doesn't exist.",
        additionalData: { qrId },
        label: "QR",
        status: 400,
      });
    }

    const owner = await getUserByID(qr.userId);
    const asset = await getAsset({ id: qr.asset.id });

    const payload = parseData(await request.formData(), NewReportSchema);
    const { email, content } = payload;

    const report = await createReport({
      email,
      content,
      assetId: qr.asset.id,
    });

    /**
     * Here we send 2 emails.
     * 1. To the owner of the asset
     * 2. To the person who reported the asset as found
     */
    await sendReportEmails({
      owner,
      asset: asset as Asset,
      message: report.content,
      reporterEmail: report.email,
    });

    return json(data({ report }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    return json(error(reason), { status: reason.status });
  }
}

export default function ContactOwner() {
  const zo = useZorm("NewQuestionWizardScreen", NewReportSchema);
  const data = useActionData<typeof action>();
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const isReported = data && !data.error;
  usePosition();

  return (
    <>
      <div className="flex-1 py-8">
        <div className="mb-8">
          <h1 className="mb-2 text-[24px] font-semibold">Contact Owner</h1>
          <p className="text-gray-600">
            Assist the owner by sharing your contact information.
          </p>
        </div>
        <Form
          method="post"
          ref={zo.ref}
          className={tw("text-left", isReported ? "hidden" : "")}
        >
          <Input
            label="Email"
            className="mb-3"
            type="email"
            autoComplete="email"
            name={zo.fields.email()}
            error={zo.errors.email()?.message}
            disabled={disabled}
            required
          />
          <div className="mb-8">
            <Input
              label="Message"
              inputType="textarea"
              name={zo.fields.content()}
              error={zo.errors.content()?.message}
              disabled={disabled}
            />
            <p className="mt-2.5 text-center text-gray-600">
              By leaving your contact information you agree that the owner of
              the asset can contact you.
            </p>
          </div>
          <Button type="submit" width="full" disabled={disabled}>
            Send
          </Button>
        </Form>
        <div
          className={tw(
            "rounded-xl border border-solid border-success-300 bg-success-25 p-4 text-center leading-none",
            isReported ? "block" : "hidden"
          )}
        >
          <p className="inline-flex items-center gap-2 font-semibold leading-none text-success-700">
            <SuccessIcon />
            Your message has been sent
          </p>
        </div>
      </div>
    </>
  );
}
