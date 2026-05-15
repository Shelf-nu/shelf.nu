import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { SignedCustodyRequestStatus } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  Form,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import { z } from "zod";
import { ErrorContent } from "~/components/errors";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { useDisabled } from "~/hooks/use-disabled";
import { completeSignedCustodyRequest } from "~/modules/custody/signed-custody.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { getValidationErrors } from "~/utils/http";
import {
  assertIsPost,
  error,
  getParams,
  parseData,
  payload,
} from "~/utils/http.server";

const ParamsSchema = z.object({ token: z.string().min(1) });
const MAX_SIGNATURE_DATA_URL_LENGTH = 250_000;

const SignCustodySchema = z.object({
  signerName: z.string().trim().min(1, "Please type your name"),
  signatureDataUrl: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z
      .string()
      .max(MAX_SIGNATURE_DATA_URL_LENGTH, "Signature image is too large")
      .regex(
        /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/,
        "Signature image must be a PNG data URL"
      )
      .optional()
  ),
});

export const meta = () => [
  { title: appendToMetaTitle("Sign custody agreement") },
];

async function getSignatureRequest(token: string) {
  const request = await db.signedCustodyRequest.findUnique({
    where: { token },
    include: {
      organization: { select: { id: true, name: true } },
      asset: { select: { id: true, title: true, status: true } },
      teamMember: {
        select: {
          id: true,
          name: true,
          userId: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      },
    },
  });

  if (!request) {
    throw new ShelfError({
      cause: null,
      title: "Signature request not found",
      message: "This custody signature request could not be found.",
      label: "Custody",
      status: 404,
      shouldBeCaptured: false,
    });
  }

  return request;
}

function getTrustedSignerIp(request: Request) {
  return request.headers.get("fly-client-ip");
}

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { token } = getParams(params, ParamsSchema, {
    additionalData: { token: params.token },
  });

  try {
    const signatureRequest = await getSignatureRequest(token);

    if (!context.isAuthenticated) {
      const redirectTo = new URL(request.url).pathname;
      return redirect(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
    }

    const authSession = context.getSession();
    if (signatureRequest.teamMember.userId !== authSession.userId) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message:
          "This custody signature request was sent to a different Shelf user.",
        label: "Custody",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    return payload({ signatureRequest });
  } catch (cause) {
    const reason = makeShelfError(cause, { token });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, params, request }: ActionFunctionArgs) {
  const { token } = getParams(params, ParamsSchema, {
    additionalData: { token: params.token },
  });

  try {
    assertIsPost(request);

    if (!context.isAuthenticated) {
      return redirect(`/login?redirectTo=/custody/sign/${token}`);
    }

    const authSession = context.getSession();
    const formData = await request.formData();
    const { signerName, signatureDataUrl } = parseData(
      formData,
      SignCustodySchema,
      {
        additionalData: { token, userId: authSession.userId },
        shouldBeCaptured: false,
      }
    );

    const signedRequest = await completeSignedCustodyRequest({
      token,
      signerUserId: authSession.userId,
      signerName,
      signatureDataUrl,
      signerIp: getTrustedSignerIp(request),
      signerUserAgent: request.headers.get("user-agent"),
    });

    sendNotification({
      title: "Custody accepted",
      message: `${signedRequest.asset.title} is now assigned to your custody.`,
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect(`/assets/${signedRequest.asset.id}`, {
      headers: [
        setCookie(
          await setSelectedOrganizationIdCookie(signedRequest.organizationId)
        ),
      ],
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { token });
    return data(error(reason), { status: reason.status });
  }
}

export const ErrorBoundary = () => <ErrorContent />;

export default function SignCustodyAgreement() {
  const { signatureRequest } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const disabled = useDisabled();
  const validationErrors = getValidationErrors<typeof SignCustodySchema>(
    actionData?.error
  );
  const alreadySigned =
    signatureRequest.status === SignedCustodyRequestStatus.SIGNED;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-12">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <p className="mb-2 text-sm font-medium text-gray-600">
          {signatureRequest.organization.name}
        </p>
        <h1 className="mb-3 text-2xl font-semibold text-gray-900">
          Custody agreement
        </h1>
        <p className="mb-6 text-gray-700">
          Review and sign before accepting custody of{" "}
          <strong>{signatureRequest.asset.title}</strong>.
        </p>

        <section className="mb-6 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            {signatureRequest.documentTitle}
          </h2>
          <p className="whitespace-pre-line">{signatureRequest.documentBody}</p>
        </section>

        {alreadySigned ? (
          <p className="text-sm text-gray-700">
            This agreement has already been signed.
          </p>
        ) : (
          <Form method="post" className="flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm font-medium text-gray-700">
              Type your name
              <input
                name="signerName"
                className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
                placeholder={signatureRequest.teamMember.name}
                disabled={disabled}
              />
              {validationErrors?.signerName?.message ? (
                <span className="text-sm font-normal text-error-600">
                  {validationErrors.signerName.message}
                </span>
              ) : null}
            </label>

            <SignaturePad disabled={disabled} />
            {validationErrors?.signatureDataUrl?.message ? (
              <p className="text-sm text-error-600">
                {validationErrors.signatureDataUrl.message}
              </p>
            ) : null}

            {actionData?.error?.message ? (
              <p className="text-sm text-error-600">
                {actionData.error.message}
              </p>
            ) : null}

            <Button type="submit" disabled={disabled}>
              Accept custody
            </Button>
          </Form>
        )}
      </div>
    </main>
  );
}

function SignaturePad({ disabled }: { disabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.lineWidth = 2;
    context.lineCap = "round";
    context.strokeStyle = "#101828";
  }, []);

  const getPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const persistSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSignatureDataUrl(canvas.toDataURL("image/png"));
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureDataUrl("");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label
          htmlFor="signature-pad"
          className="text-sm font-medium text-gray-700"
        >
          Draw your signature
        </label>
        <button
          type="button"
          className="text-sm font-medium text-primary-600"
          onClick={clearSignature}
          disabled={disabled}
        >
          Clear
        </button>
      </div>
      <canvas
        id="signature-pad"
        ref={canvasRef}
        width={720}
        height={180}
        className="h-40 w-full touch-none rounded-md border border-gray-300 bg-white"
        onPointerDown={(event) => {
          if (disabled) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = getPoint(event);
          const context = event.currentTarget.getContext("2d");
          context?.beginPath();
          context?.moveTo(point.x, point.y);
          setDrawing(true);
        }}
        onPointerMove={(event) => {
          if (!drawing || disabled) return;
          const point = getPoint(event);
          const context = event.currentTarget.getContext("2d");
          context?.lineTo(point.x, point.y);
          context?.stroke();
          persistSignature();
        }}
        onPointerUp={() => {
          setDrawing(false);
          persistSignature();
        }}
        onPointerCancel={() => setDrawing(false)}
      />
      <input type="hidden" name="signatureDataUrl" value={signatureDataUrl} />
    </div>
  );
}
