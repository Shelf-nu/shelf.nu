import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { getParams } from "~/utils/http.server";

/**
 * Splat route to handle requests with data after userId in the url
 * This is mostly made for handling users cmd+click on asset or booking in user page
 */
export const loader = ({ request, params }: LoaderFunctionArgs) => {
  const { userId: selectedUserId } = getParams(
    params,
    z.object({ userId: z.string() })
  );

  /** Split the url based on the user id */
  const extraParts = request.url.split(selectedUserId);

  return redirect(extraParts[extraParts.length - 1]);
};
