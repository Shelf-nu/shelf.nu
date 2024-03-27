import { InviteStatuses } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { z } from "zod";
import { Spinner } from "~/components/shared/spinner";
import { signInWithEmail } from "~/modules/auth/service.server";
import { generateRandomCode } from "~/modules/invite/helpers";
import {
  checkUserAndInviteMatch,
  updateInviteStatus,
} from "~/modules/invite/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { setCookie } from "~/utils/cookies.server";
import { INVITE_TOKEN_SECRET } from "~/utils/env";
import { ShelfError, makeShelfError } from "~/utils/error";
import { error, parseData, safeRedirect } from "~/utils/http.server";
import jwt from "~/utils/jsonwebtoken.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  try {
    /** Here we have to do a check based on the session of the current user
     * If the user is already signed in, we have to make sure the invite sent, is for the same user
     */
    if (context.isAuthenticated) {
      await checkUserAndInviteMatch({ context, params });
    }

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
    ).catch(
      // We don't care about the error here, let the user login if he's already registered
      () => null
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

    throw json(
      error({ ...reason, title: reason.title || "Accept team invite" }),
      {
        status: reason.status,
      }
    );
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
