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
import { signInWithEmail } from "~/modules/auth/service.server";
import { ensurePortalMembership } from "~/modules/portal/portal.server";
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
import { validEmail } from "~/utils/misc";

export function loader({ context }: LoaderFunctionArgs) {
  if (context.isAuthenticated) {
    return redirect("/portal");
  }
  return data({ ok: true });
}

const LoginSchema = z.object({
  email: z
    .string()
    .transform((e) => e.toLowerCase())
    .refine(validEmail, () => ({ message: "Email non valida" })),
  password: z.string().min(1, "Inserisci la password"),
  redirectTo: z.string().optional(),
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
    const { email, password, redirectTo } = parseData(formData, LoginSchema, {
      shouldBeCaptured: false,
    });

    const authSession = await signInWithEmail(email, password);
    if (!authSession) {
      return redirect(
        `/portal/otp?email=${encodeURIComponent(email)}&mode=login`
      );
    }

    await ensurePortalMembership(authSession.userId);
    context.setSession(authSession);

    return redirect(safeRedirect(redirectTo || "/portal"));
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
  { title: appendToMetaTitle("Accedi") },
];

export default function PortalLogin() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const disabled = nav.state !== "idle";
  const errMsg =
    actionData && "error" in actionData ? actionData.error.message : null;

  return (
    <section className="flex min-h-[80vh] items-center justify-center px-4 py-10">
      <PortalCard className="w-full max-w-md">
        <h1 className="portal-h2 mb-2 text-center">Accedi</h1>
        <p className="mb-6 text-center text-[var(--portal-on-surface-variant)]">
          Bentornato! Inserisci le tue credenziali.
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
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
          {errMsg && (
            <div className="rounded-lg bg-[var(--portal-error-container)] px-3 py-2 text-sm text-[var(--portal-on-error-container)]">
              {errMsg}
            </div>
          )}
          <PortalButton type="submit" size="lg" disabled={disabled}>
            {disabled ? "Accesso in corso…" : "Accedi"}
          </PortalButton>
        </Form>
        <p className="mt-6 text-center text-sm text-[var(--portal-on-surface-variant)]">
          Non hai un account?{" "}
          <Link
            to="/portal/join"
            className="font-semibold text-[var(--portal-primary)]"
          >
            Registrati
          </Link>
        </p>
      </PortalCard>
    </section>
  );
}
