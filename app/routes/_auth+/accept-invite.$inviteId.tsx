import { InviteStatuses } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { z } from "zod";
import { Spinner } from "~/components/shared/spinner";
import { signInWithEmail } from "~/modules/auth";
import { updateInviteStatus } from "~/modules/invite";
import { generateRandomCode } from "~/modules/invite/helpers";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { INVITE_TOKEN_SECRET, error, parseData, safeRedirect } from "~/utils";
import { setCookie } from "~/utils/cookies.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import jwt from "~/utils/jsonwebtoken.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  try {
    const { token } = parseData(
      new URL(decodeURIComponent(request.url)).searchParams,
      z.object({ token: z.string() }),
      {
        message:
          "The invitation link doesn't have a token provided. Please try clicking the link in your email again or request a new invite. If the issue persists, feel free to contact support",
      }
    );

    const decodedInvite = jwt.verify(token, INVITE_TOKEN_SECRET) as {
      id: string;
    };
    const password = generateRandomCode(10);
    const updatedInvite = await updateInviteStatus({
      id: decodedInvite.id,
      status: InviteStatuses.ACCEPTED,
      password,
    });

    if (updatedInvite.status !== InviteStatuses.ACCEPTED) {
      throw new ShelfError({
        cause: null,
        message:
          "Something went wrong with updating your invite. Please try again",
        label: "Invite",
      });
    }

    /** If the user is already signed in, we jus redirect them to assets index and set */
    if (context.isAuthenticated) {
      return redirect(safeRedirect(`/assets`), {
        headers: [
          setCookie(
            await setSelectedOrganizationIdCookie(updatedInvite.organizationId)
          ),
        ],
      });
    }

    /** Sign in the user */
    const authSession = await signInWithEmail(
      updatedInvite.inviteeEmail,
      password
    );
    /**
     * User could already be registered and hence login in with our password failed,
     * redirect to home and let user login or go to home */
    if (!authSession) {
      return redirect("/login?acceptedInvite=yes");
    }

    // Commit the session
    context.setSession(authSession);

    return redirect(
      safeRedirect(
        `/onboarding?organizationId=${updatedInvite.organizationId}`
      ),
      {
        headers: [
          setCookie(
            await setSelectedOrganizationIdCookie(updatedInvite.organizationId)
          ),
        ],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause);

    if (cause instanceof Error && cause.name === "JsonWebTokenError") {
      reason.message =
        "The invitation link is invalid. Please try clicking the link in your email again or request a new invite. If the issue persists, feel free to contact support";
    }

    throw json(error({ ...reason, title: "Accept team invite" }), {
      status: reason.status,
    });
  }
}

export default function AcceptInvite() {
  return (
    <div className=" flex max-w-[400px] flex-col items-center text-center">
      <Spinner />
      <p className="mt-2">Validating token...</p>
    </div>
  );
}
