import { InviteStatuses } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import { useDisabled } from "~/hooks/use-disabled";
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
import {
  data,
  error,
  getParams,
  parseData,
  safeRedirect,
} from "~/utils/http.server";
import jwt from "~/utils/jsonwebtoken.server";

export async function loader({ context, params }: LoaderFunctionArgs) {
  const { inviteId } = getParams(params, z.object({ inviteId: z.string() }), {
    additionalData: { inviteId: params.inviteId },
  });
  try {
    /** We get the invite based on the id of the params */
    const invite = await db.invite
      .findFirstOrThrow({
        where: {
          id: inviteId,
        },
        include: {
          organization: {
            select: {
              name: true,
            },
          },
          inviter: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          title: "Invite not found",
          message:
            "The invitation you are trying to accept is either not found or expired",
          label: "Invite",
        });
      });

    /** Here we have to do a check based on the session of the current user
     * If the user is already signed in, we have to make sure the invite sent, is for the same user
     */
    if (context.isAuthenticated) {
      await checkUserAndInviteMatch({
        context,
        invite,
      });
    }

    return json(
      data({
        inviter: `${invite.inviter.firstName} ${invite.inviter.lastName}`,
        workspace: `${invite.organization.name}`,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(
      error({ ...reason, title: reason.title || "Accept team invite" }),
      {
        status: reason.status,
      }
    );
  }
}

export async function action({ context, request }: LoaderFunctionArgs) {
  try {
    const { token } = parseData(
      await request.formData(),
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

    return json(
      error({ ...reason, title: reason.title || "Accept team invite" }),
      {
        status: reason.status,
      }
    );
  }
}

export default function AcceptInvite() {
  const { inviter, workspace } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const disabled = useDisabled();
  const actionData = useActionData<typeof action>();
  const error = actionData?.error;
  return (
    <>
      <div className=" flex  flex-col items-center text-center">
        <h2>Accept invite</h2>
        <p>
          <strong>{inviter}</strong> invites you to join Shelf as a member of{" "}
          <strong>{workspace}’s</strong> workspace.
        </p>
        <Form method="post" className="my-3">
          <input
            type="hidden"
            name="token"
            value={searchParams.get("token") || ""}
          />
          {error && (
            <p className="mx-[-200px] mb-3 text-sm text-error-500">
              {error.message}
            </p>
          )}
          <Button type="submit" disabled={disabled || error}>
            {disabled ? "Validating token..." : "Accept invite"}
          </Button>
        </Form>
      </div>
      <div className=" mx-[-200px] mt-20 flex flex-col items-center text-center text-gray-600">
        <p>
          If you have any questions or need assistance, please don't hesitate to
          contact our support team at support@shelf.nu.
        </p>
      </div>
    </>
  );
}
