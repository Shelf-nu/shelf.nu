import React, { useState, useRef, useEffect } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useFetcher, useLoaderData } from "react-router";
import { BellIcon, ExternalLinkIcon } from "lucide-react";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { Spinner } from "~/components/shared/spinner";
import useApiQuery from "~/hooks/use-api-query";
import type { UpdateForUser } from "~/modules/update/service.server";
import type { loader } from "~/routes/_layout+/_layout";
import { tw } from "~/utils/tw";
import { SidebarMenuButton, SidebarMenuItem } from "./sidebar";

export default function UpdatesNavItem() {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher({ key: "updates-change" });
  const viewsTrackedRef = useRef(false);
  const [readUpdateIds, setReadUpdateIds] = useState<Set<string>>(new Set());
  const [optimisticMarkAllRead, setOptimisticMarkAllRead] = useState(false);
  const { unreadUpdatesCount } = useLoaderData<typeof loader>();

  // Fetch updates when popover opens
  const { data, isLoading } = useApiQuery<{ updates: UpdateForUser[] }>({
    api: "/api/updates",
    enabled: open,
  }); // Only show Updates on desktop - handled with CSS instead of conditional return
  const updates = data?.updates ?? [];
  // Calculate unread count including optimistic updates
  const unreadCount =
    updates?.length > 0
      ? updates.filter(
          (update) =>
            update.userReads.length === 0 && !readUpdateIds.has(update.id)
        ).length
      : optimisticMarkAllRead
      ? 0
      : unreadUpdatesCount;

  const hasUnread = unreadCount > 0;

  // Reset optimistic flag when fetcher completes successfully
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      setOptimisticMarkAllRead(false);
    }
  }, [fetcher.state, fetcher.data]);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);

    if (isOpen) {
      if (updates && updates?.length > 0 && !viewsTrackedRef.current) {
        // Track view for all unread updates when popover opens (excluding optimistically read ones)
        const unreadUpdates = updates?.filter(
          (u) => u.userReads.length === 0 && !readUpdateIds.has(u.id)
        );
        if (unreadUpdates.length > 0) {
          viewsTrackedRef.current = true;
          fetcher.submit(
            {
              intent: "trackViews",
              updateIds: unreadUpdates.map((u) => u.id).join(","),
            },
            { method: "POST", action: "/api/updates" }
          );
        }
      }
    } else {
      // Reset the ref when popover closes
      viewsTrackedRef.current = false;
    }
  };

  const handleMarkAllAsRead = () => {
    // Optimistic update - mark all updates as read immediately in local state
    const unreadUpdateIds = updates
      .filter((u) => u.userReads.length === 0 && !readUpdateIds.has(u.id))
      .map((u) => u.id);

    setReadUpdateIds((prev) => {
      const newSet = new Set(prev);
      unreadUpdateIds.forEach((id) => newSet.add(id));
      return newSet;
    });

    // Set optimistic flag to hide button and dot immediately
    setOptimisticMarkAllRead(true);

    fetcher.submit(
      { intent: "markAllAsRead" },
      { method: "POST", action: "/api/updates" }
    );
  };

  const handleUpdateClick = (updateId: string, url?: string | null) => {
    // Optimistic update - mark as read immediately in local state
    setReadUpdateIds((prev) => new Set(prev).add(updateId));

    // Mark as read AND track click in single API call
    fetcher.submit(
      { intent: "clickUpdate", updateId },
      { method: "POST", action: "/api/updates" }
    );

    // Open URL only if it exists
    if (url) {
      window.open(url, "_blank");
    }
    handleOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <SidebarMenuItem className="hidden md:block">
          <SidebarMenuButton
            className={tw(
              "font-semibold",
              open && "bg-sidebar-accent text-sidebar-accent-foreground"
            )}
            tooltip="Updates"
          >
            <div className="relative">
              <BellIcon className="size-4 text-gray-600" />
              {hasUnread && (
                <div
                  className="absolute -right-1 -top-1 size-2 animate-pulse rounded-full bg-blue-500"
                  style={{ animationDuration: "1s" }}
                />
              )}
            </div>
            <span>Updates</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="end"
          side="right"
          sideOffset={8}
          className="z-50 w-[450px] rounded-md border border-gray-200 bg-white shadow-lg"
        >
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-text-md font-semibold text-gray-900">
                Updates
              </h3>
              {hasUnread && (
                <Button
                  onClick={handleMarkAllAsRead}
                  className="text-xs text-gray-600"
                  variant="block-link-gray"
                >
                  Mark all read
                </Button>
              )}
            </div>

            {isLoading ? (
              <div className="py-8 text-center">
                <Spinner className="mx-auto" />
                <p className="mt-2 text-sm text-gray-500">Loading updates...</p>
              </div>
            ) : updates && updates?.length > 0 ? (
              <div
                className="max-h-80 space-y-3 overflow-y-auto"
                style={{
                  WebkitOverflowScrolling: "touch",
                  touchAction: "pan-y",
                }}
              >
                {updates.map((update) => {
                  const isUnread =
                    update.userReads.length === 0 &&
                    !readUpdateIds.has(update.id);
                  return (
                    <div
                      key={update.id}
                      className={tw(
                        "rounded-md border p-3 transition-colors",
                        update.url ? "cursor-pointer" : "cursor-default",
                        isUnread
                          ? "border-blue-200 bg-blue-50"
                          : "border-gray-200 bg-gray-50",
                        update.url &&
                          (isUnread ? "hover:bg-blue-100" : "hover:bg-gray-100")
                      )}
                      onClick={() => handleUpdateClick(update.id, update.url)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4
                              className={tw(
                                "truncate text-sm font-medium",
                                isUnread ? "text-blue-900" : "text-gray-900"
                              )}
                            >
                              {update.title}
                            </h4>
                            {isUnread && (
                              <div className="size-2 shrink-0 rounded-full bg-blue-500" />
                            )}
                          </div>
                          <div
                            className={tw(
                              "mt-1 text-xs",
                              isUnread ? "text-blue-700" : "text-gray-600"
                            )}
                          >
                            <MarkdownViewer content={update.content} />
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <p
                              className={tw(
                                "text-xs",
                                isUnread ? "text-blue-600" : "text-gray-500"
                              )}
                            >
                              <DateS date={update.publishDate} />
                            </p>
                            {update.url && (
                              <ExternalLinkIcon
                                className={tw(
                                  "size-3",
                                  isUnread ? "text-blue-600" : "text-gray-400"
                                )}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center">
                <BellIcon className="mx-auto size-12 text-gray-300" />
                <p className="mt-2 text-sm text-gray-500">
                  No updates available
                </p>
              </div>
            )}
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
