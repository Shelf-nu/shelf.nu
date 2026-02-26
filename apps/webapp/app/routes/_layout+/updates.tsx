import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import { data, useLoaderData } from "react-router";
import { UpdateTimeline } from "~/components/update/update-timeline";
import { getUpdatesForUser } from "~/modules/update/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { error, payload } from "~/utils/http.server";
import { parseMarkdownToReact } from "~/utils/md";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const meta = () => [{ title: appendToMetaTitle("Updates") }];

export function shouldRevalidate({
  formAction,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  // Don't revalidate when marking updates as read
  if (formAction === "/api/updates") {
    return false;
  }
  return defaultShouldRevalidate;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { role } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.update,
      action: PermissionAction.read,
    });

    // Get updates for the user with their organization role
    const updates = await getUpdatesForUser({
      userId,
      userRole: role,
    });

    return data(
      payload({
        updates: updates.map((update) => ({
          ...update,
          content: parseMarkdownToReact(update.content),
        })),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export default function UpdatesPage() {
  const { updates } = useLoaderData<typeof loader>();

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-12 md:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-16 text-center">
        <img
          src="/static/images/new.gif"
          alt="Updates"
          className="mx-auto mb-6"
        />
        <h1 className="text-5xl font-bold tracking-tight text-color-900">
          Latest Updates
        </h1>
      </div>

      {/* Timeline */}
      <UpdateTimeline updates={updates} />
    </div>
  );
}
