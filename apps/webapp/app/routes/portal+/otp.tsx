import { OrganizationRoles } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import {
  data,
  redirect,
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { z } from "zod";
import { PortalButton } from "~/components/portal/portal-button";
import { PortalCard } from "~/components/portal/portal-card";
import { PortalInput } from "~/components/portal/portal-input";
import { sendOTP, verifyOtpAndSignin } from "~/modules/auth/service.server";
import {
  ensurePortalMembership,
  resolvePortalOrgId,
} from "~/modules/portal/portal.server";
import { createUser, findUserByEmail } from "~/modules/user/service.server";
import { generateUniqueUsername } from "~/modules/user/utils.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  ShelfError,
  isLikeShelfError,
  isZodValidationError,
  makeShelfError,
} from "~/utils/error";
import {
  error,
  getActionMethod,
  parseData,
  safeRedirect,
} from "~/utils/http.server";

const Modes = ["confirm_signup", "login"] as const;
type Mode = (typeof Modes)[number];

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const email = url.searchParams.get("email") ?? "";
  const mode = (url.searchParams.get("mode") as Mode) ?? "confirm_signup";
  if (!email || !Modes.includes(mode)) {
    throw redirect("/portal/login");
  }
  return data({ email, mode });
}

const OtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().min(6, "Codice non valido").max(6),
});

export async function action({ context, request }: ActionFunctionArgs) {
  try {
    if (getActionMethod(request) !== "POST") {
      throw new ShelfError({
        cause: null,
        message: "Method not allowed",
        label: "Portal",
        status: 405,
      });
    }
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "resend") {
      const email = String(formData.get("email") ?? "").toLowerCase();
      if (!email) {
        throw new ShelfError({
          cause: null,
          message: "Email mancante",
          label: "Portal",
          status: 400,
        });
      }
      await sendOTP(email);
      return data({ resent: true } as const);
    }

    const { email, otp } = parseData(formData, OtpSchema, {
      shouldBeCaptured: false,
    });

    const authSession = await verifyOtpAndSignin(email, otp);
    const orgId = await resolvePortalOrgId();

    const existing = await findUserByEmail(email);
    if (!existing) {
      const username = await generateUniqueUsername(authSession.email);
      await createUser({
        ...authSession,
        username,
        organizationId: orgId,
        roles: [OrganizationRoles.SELF_SERVICE],
      });
    } else {
      await ensurePortalMembership(authSession.userId);
    }

    context.setSession(authSession);
    return redirect(safeRedirect("/portal"));
  } catch (cause) {
    const reason = makeShelfError(
      cause,
      undefined,
      isLikeShelfError(cause)
        ? cause.shouldBeCaptured
        : !isZodValidationError(cause)
    );
    return data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Conferma email") },
];

export default function PortalOtp() {
  const { email, mode } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const disabled = nav.state !== "idle";

  const errMsg =
    actionData && "error" in actionData ? actionData.error.message : null;
  const resent = actionData && "resent" in actionData;

  return (
    <section className="flex min-h-[80vh] items-center justify-center px-4 py-10">
      <PortalCard className="w-full max-w-md">
        <h1 className="portal-h2 mb-2 text-center">
          {mode === "confirm_signup"
            ? "Conferma la tua email"
            : "Verifica accesso"}
        </h1>
        <p className="mb-6 text-center text-[var(--portal-on-surface-variant)]">
          Abbiamo inviato un codice a 6 cifre a <strong>{email}</strong>.
          Inseriscilo qui sotto per continuare.
        </p>
        <Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="email" value={email} />
          <PortalInput
            name="otp"
            type="text"
            inputMode="numeric"
            maxLength={6}
            label="Codice di verifica"
            placeholder="123456"
            required
            autoFocus
            autoComplete="one-time-code"
          />
          {resent && (
            <div className="rounded-lg bg-[color-mix(in_srgb,var(--portal-success)_15%,transparent)] px-3 py-2 text-sm text-[var(--portal-success)]">
              Codice rinviato — controlla la casella email.
            </div>
          )}
          {errMsg && (
            <div className="rounded-lg bg-[var(--portal-error-container)] px-3 py-2 text-sm text-[var(--portal-on-error-container)]">
              {errMsg}
            </div>
          )}
          <PortalButton type="submit" size="lg" disabled={disabled}>
            {disabled ? "Verifica…" : "Conferma"}
          </PortalButton>
        </Form>
        <Form method="post" className="mt-4 text-center">
          <input type="hidden" name="email" value={email} />
          <button
            type="submit"
            name="intent"
            value="resend"
            disabled={disabled}
            className="text-sm font-semibold text-[var(--portal-primary)] hover:underline"
          >
            Non hai ricevuto il codice? Invia di nuovo
          </button>
        </Form>
      </PortalCard>
    </section>
  );
}
