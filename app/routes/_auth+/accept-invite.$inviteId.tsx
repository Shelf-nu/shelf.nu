import { InviteStatuses } from "@prisma/client";
import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import jwt from "jsonwebtoken";
import { Spinner } from "~/components/shared/spinner";
import { commitAuthSession, signInWithEmail } from "~/modules/auth";
import { updateInviteStatus } from "~/modules/invite";
import { generateRandomCode } from "~/modules/invite/helpers";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import {
  INVITE_TOKEN_SECRET,
  getCurrentSearchParams,
  safeRedirect,
} from "~/utils";
import { setCookie } from "~/utils/cookies.server";
import { ShelfStackError } from "~/utils/error";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const searchParams = getCurrentSearchParams(request);
  const token = searchParams.get("token") as string;

  if (!token) {
    throw new ShelfStackError({
      message:
        "The invitation link doesn't have a token provided. Please try clicking the link in your email again or request a new invite. If the issue persists, feel free to contact support",
    });
  }
  const decodedInvite = jwt.verify(token, INVITE_TOKEN_SECRET) as {
    id: string;
  };

  const password = generateRandomCode(10);
  const updatedInvite = await updateInviteStatus({
    id: decodedInvite.id,
    status: InviteStatuses.ACCEPTED,
    password,
  });

  if (updatedInvite?.status !== InviteStatuses.ACCEPTED) {
    throw new ShelfStackError({
      message:
        "Something went wrong with updating your invite. Please try again",
    });
  }

  /** Sign in the user */
  const signInResult = await signInWithEmail(
    updatedInvite.inviteeEmail,
    password
  );

  if (signInResult.status === "error") {
    //user could already be registered and hence loggin in with our password failed, redirect to home and let user login or go to home
    return redirect("/login?acceptedInvite=yes");
  }

  // Ensure that user property exists before proceeding
  if (signInResult.status === "success" && signInResult.authSession) {
    const { authSession } = signInResult;

    return redirect(
      safeRedirect(
        `/onboarding?organizationId=${updatedInvite.organizationId}`
      ),
      {
        headers: [
          setCookie(await setSelectedOrganizationIdCookie(updatedInvite.id)),
          setCookie(
            await commitAuthSession(request, {
              authSession,
              flashErrorMessage: null,
            })
          ),
        ],
      }
    );
  }

  return json({ title: "Accept team invite" });
};

export default function AcceptInvite() {
  return (
    <div className=" flex max-w-[400px] flex-col items-center text-center">
      <Spinner />
      <p className="mt-2">Validating token...</p>
    </div>
  );
}
