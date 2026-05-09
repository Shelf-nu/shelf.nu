import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import {
  data,
  redirect,
  Form,
  Link,
  useActionData,
  useNavigation,
} from "react-router";
import { z } from "zod";
import { PortalButton } from "~/components/portal/portal-button";
import { PortalCard } from "~/components/portal/portal-card";
import { PortalInput } from "~/components/portal/portal-input";
import { signUpWithEmailPass } from "~/modules/auth/service.server";
import { findUserByEmail } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  ShelfError,
  isLikeShelfError,
  isZodValidationError,
  makeShelfError,
} from "~/utils/error";
import { error, getActionMethod, parseData } from "~/utils/http.server";
import { validEmail } from "~/utils/misc";
import { validateNonSSOSignup } from "~/utils/sso.server";

export function loader({ context }: LoaderFunctionArgs) {
  if (context.isAuthenticated) {
    return redirect("/portal");
  }
  return data({ ok: true });
}

const JoinSchema = z
  .object({
    email: z
      .string()
      .transform((e) => e.toLowerCase())
      .refine(validEmail, () => ({ message: "Email non valida" })),
    password: z
      .string()
      .min(8, "La password deve essere di almeno 8 caratteri"),
    confirmPassword: z.string().min(8, "Conferma la password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Le password non coincidono",
    path: ["confirmPassword"],
  });

export async function action({ request }: ActionFunctionArgs) {
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
    const { email, password } = parseData(formData, JoinSchema, {
      shouldBeCaptured: false,
    });

    await validateNonSSOSignup(email);
    const existing = await findUserByEmail(email);
    if (existing) {
      throw new ShelfError({
        cause: null,
        message:
          "Esiste già un account con questa email. Accedi invece di registrarti.",
        label: "Portal",
        status: 409,
        shouldBeCaptured: false,
      });
    }

    await signUpWithEmailPass(email, password);
    return redirect(
      `/portal/otp?email=${encodeURIComponent(email)}&mode=confirm_signup`
    );
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
  { title: appendToMetaTitle("Registrati") },
];

export default function PortalJoin() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const disabled = nav.state !== "idle";
  const errMsg =
    actionData && "error" in actionData ? actionData.error.message : null;

  return (
    <section className="flex min-h-[80vh] items-center justify-center px-4 py-10">
      <PortalCard className="w-full max-w-md">
        <h1 className="portal-h2 mb-2 text-center">Crea il tuo account</h1>
        <p className="mb-6 text-center text-[var(--portal-on-surface-variant)]">
          Inizia a prenotare strumenti dell&apos;Attrezzoteca.
        </p>
        <Form method="post" className="flex flex-col gap-4">
          <PortalInput
            name="email"
            type="email"
            label="Email"
            placeholder="tu@example.com"
            autoComplete="email"
            required
            autoFocus
          />
          <PortalInput
            name="password"
            type="password"
            label="Password"
            hint="Almeno 8 caratteri"
            autoComplete="new-password"
            required
          />
          <PortalInput
            name="confirmPassword"
            type="password"
            label="Conferma password"
            autoComplete="new-password"
            required
          />
          {errMsg && (
            <div className="rounded-lg bg-[var(--portal-error-container)] px-3 py-2 text-sm text-[var(--portal-on-error-container)]">
              {errMsg}
            </div>
          )}
          <PortalButton type="submit" size="lg" disabled={disabled}>
            {disabled ? "Creazione in corso…" : "Registrati"}
          </PortalButton>
        </Form>
        <p className="mt-6 text-center text-sm text-[var(--portal-on-surface-variant)]">
          Hai già un account?{" "}
          <Link
            to="/portal/login"
            className="font-semibold text-[var(--portal-primary)]"
          >
            Accedi
          </Link>
        </p>
      </PortalCard>
    </section>
  );
}
