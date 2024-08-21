import { json, type ActionFunctionArgs } from "@remix-run/node";
import { useActionData, useNavigation } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import { SuccessIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { usePosition } from "~/hooks/use-position";
import {
  createReport,
  sendReportEmails,
} from "~/modules/report-found/service.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  assertIsPost,
  data,
  error,
  getParams,
  parseData,
} from "~/utils/http.server";
import { tw } from "~/utils/tw";

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
      .findUniqueOrThrow({
        where: {
          id: qrId,
        },
        include: {
          asset: {
            include: {
              organization: {
                select: {
                  owner: {
                    select: {
                      email: true,
                      id: true,
                    },
                  },
                },
              },
            },
          },
          kit: true,
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

    /**
     * This should not happen as the user will be redirected to claim the code before they ever land on this page.
     * We still handle it just in case also to keep TS happy.
     */
    if (!qr.organizationId || !qr?.userId) {
      throw new ShelfError({
        cause: null,
        title: "Unclaimed QR code",
        message:
          "This QR doesn't belong to any user or organization so it cannot be reported as found. If you think this is a mistake, please contact support.",
        label: "QR",
      });
    }

    const ownerEmail = qr?.asset?.organization?.owner.email;

    const payload = parseData(await request.formData(), NewReportSchema);
    const { email, content } = payload;

    const report = await createReport({
      email,
      content,
      assetId: qr?.asset?.id,
      kitId: qr?.kit?.id,
    });

    /**
     * Here we send 2 emails.
     * 1. To the owner of the asset
     * 2. To the person who reported the asset as found
     */
    if (ownerEmail) {
      await sendReportEmails({
        ownerEmail,
        qr,
        message: report.content,
        reporterEmail: report.email,
      });
    }

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
