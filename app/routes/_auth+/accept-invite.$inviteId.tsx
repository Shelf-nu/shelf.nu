import { InviteStatuses } from "@prisma/client";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import jwt from "jsonwebtoken";
import { Spinner } from "~/components/shared/spinner";
import { createAuthSession, signInWithEmail } from "~/modules/auth";
import { updateInviteStatus } from "~/modules/invite";
import { generateRandomCode } from "~/modules/invite/helpers";
import { INVITE_TOKEN_SECRET, getCurrentSearchParams } from "~/utils";
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

  // @TODO here we are having some polifyll issues with the jwt library
  // I think its because we also have client side code in this. What we have to try is abstracting the verify to a .server.ts file to see if the issue persists
  var decodedInvite = jwt.verify(token, INVITE_TOKEN_SECRET);

  // @TODO I am not sure why verify can return a string. It throws an Error if token is invalid which is being captured by the our error handler
  // This is a temporary fix.
  if (typeof decodedInvite === "string") {
    throw new ShelfStackError({
      message: "Something went wrong. Please try again",
    });
  }

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

  if (signInResult.status === "error" && signInResult?.message) {
    throw new ShelfStackError({
      message: signInResult.message,
    });
  }

  // Ensure that user property exists before proceeding
  if (signInResult.status === "success" && signInResult.authSession) {
    return createAuthSession({
      request,
      authSession: signInResult.authSession,
      redirectTo: "/onboarding",
    });
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
