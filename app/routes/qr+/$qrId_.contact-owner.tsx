import type { Asset } from "@prisma/client";
import { json, type ActionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { SuccessIcon } from "~/components/icons";
import { Button } from "~/components/shared/button";
import { usePosition } from "~/hooks";
import { getAsset } from "~/modules/asset";
import { getQr } from "~/modules/qr";
import { createReport, sendReportEmails } from "~/modules/report-found";
import { getUserByID } from "~/modules/user";
import { assertIsPost, isFormProcessing, tw } from "~/utils";

export const NewReportSchema = z.object({
  email: z
    .string()
    .email("Please enter a valid Email address")
    .transform((email) => email.toLowerCase()),
  content: z.string().min(3, "Content is required"),
});

export const action = async ({ request, params }: ActionArgs) => {
  assertIsPost(request);
  const qrId = params.qrId as string;
  const qr = await getQr(qrId);

  if (!qr || !qr.assetId) {
    return new Response("QR code doesnt exist.", { status: 400 });
  }

  const owner = await getUserByID(qr.userId);
  if (!owner) return new Response("Something went wrong", { status: 500 });
  const asset = await getAsset({ userId: owner.id, id: qr.assetId });

  const formData = await request.formData();
  const result = await NewReportSchema.safeParseAsync(parseFormAny(formData));
  if (!result.success) {
    return json({
      errors: result.error,
    });
  }

  const { email, content } = result.data;

  const report = await createReport({
    email,
    content,
    assetId: qr.assetId,
  });
  if (!report) return new Response("Something went wrong", { status: 500 });

  /**
   * Here we send 2 emails.
   * 1. To the owner of the asset
   * 2. To the person who reported the asset as found
   */
  sendReportEmails({
    owner,
    asset: asset as Asset,
    message: report.content,
    reporterEmail: report.email,
  });
  return json({ report });
};

export default function ContactOwner() {
  const zo = useZorm("NewQuestionWizardScreen", NewReportSchema);
  const data = useActionData();
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
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
          className={tw("text-left", data?.report ? "hidden" : "")}
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
          <Button width="full" disabled={disabled}>
            Send
          </Button>
        </Form>
        <div
          className={tw(
            "rounded-xl border border-solid border-success-300 bg-success-25 p-4 text-center leading-[1]",
            data?.report ? "block" : "hidden"
          )}
        >
          <p className="inline-flex items-center gap-2 font-semibold leading-[1] text-success-700">
            <SuccessIcon />
            Your message has been sent
          </p>
        </div>
      </div>
    </>
  );
}
