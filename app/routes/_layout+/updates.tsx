import { useEffect, useRef } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Badge } from "~/components/shared/badge";
import { DateS } from "~/components/shared/date";
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
import { tw } from "~/utils/tw";

export const meta = () => [{ title: appendToMetaTitle("Updates") }];

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
  const fetcher = useFetcher();
  const viewsTrackedRef = useRef(false);

  // Mark all updates as read when the page loads (visiting the page = reading)
  useEffect(() => {
    if (updates && updates.length > 0 && !viewsTrackedRef.current) {
      const unreadUpdates = updates.filter((u) => u.userReads.length === 0);
      if (unreadUpdates.length > 0) {
        viewsTrackedRef.current = true;
        fetcher.submit(
          {
            intent: "markAllAsRead",
          },
          { method: "POST", action: "/api/updates" }
        );
      }
    }
  }, [updates, fetcher]);

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 py-12 md:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-12 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-gray-900">
          Latest Updates
        </h1>
      </div>

      {/* Filter tabs - placeholder for future enhancement */}
      <div className="mb-12 flex items-center justify-center gap-6 text-sm">
        <button
          className={tw(
            "font-medium transition-colors",
            "border-b-2 border-gray-900 pb-1 text-gray-900"
          )}
        >
          All
        </button>
        <button
          className={tw(
            "font-medium text-gray-500 transition-colors hover:text-gray-900",
            "pb-1"
          )}
          disabled
        >
          Announcements
        </button>
        <button
          className={tw(
            "font-medium text-gray-500 transition-colors hover:text-gray-900",
            "pb-1"
          )}
          disabled
        >
          Changelog
        </button>
      </div>

      {/* Updates List */}
      {updates.length > 0 ? (
        <div className="space-y-12">
          {updates.map((update) => {
            const isUnread = update.userReads.length === 0;
            return (
              <article
                key={update.id}
                className={tw(
                  "relative rounded-xl border border-gray-200 bg-white p-8 shadow-sm transition-all",
                  isUnread && "ring-2 ring-blue-500 ring-offset-2"
                )}
              >
                {/* Date, Time, and Badge */}
                <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-gray-600">
                  <time className="font-medium text-gray-900">
                    <DateS date={update.publishDate} format="MMMM DD, YYYY" />
                  </time>
                  <span className="text-gray-400">•</span>
                  <time className="text-gray-600">
                    <DateS date={update.publishDate} format="h:mm A" />
                  </time>
                  {isUnread && (
                    <>
                      <span className="text-gray-400">•</span>
                      <Badge color="blue" className="text-xs">
                        New
                      </Badge>
                    </>
                  )}
                  {update.url && (
                    <>
                      <span className="text-gray-400">•</span>
                      <Badge color="gray" className="text-xs">
                        📎 Link
                      </Badge>
                    </>
                  )}
                </div>

                {/* Title */}
                <h2 className="mb-6 text-3xl font-bold leading-tight text-gray-900">
                  {update.title}
                </h2>

                {/* Content */}
                <div className="prose prose-gray max-w-none text-[15px] leading-relaxed text-gray-700">
                  <MarkdownViewer content={update.content} />
                </div>

                {/* Optional Link */}
                {update.url && (
                  <div className="mt-8 border-t border-gray-100 pt-6">
                    <a
                      href={update.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-gray-800 hover:shadow-md"
                    >
                      Learn More
                      <svg
                        className="size-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                    </a>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="py-24 text-center">
          <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-gray-100">
            <svg
              className="size-10 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
          </div>
          <h3 className="mb-2 text-xl font-semibold text-gray-900">
            No updates yet
          </h3>
          <p className="text-sm text-gray-600">
            Check back later for the latest news and updates
          </p>
        </div>
      )}
    </div>
  );
}
