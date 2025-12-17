import { useCallback, useEffect, useRef } from "react";
import type { RenderableTreeNodes } from "@markdoc/markdoc";
import type { Update, UserUpdateRead } from "@prisma/client";
import { ExternalLinkIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Badge } from "~/components/shared/badge";
import { DateS } from "~/components/shared/date";
import { tw } from "~/utils/tw";

type UpdateWithParsedContent = Omit<Update, "content"> & {
  content: string | RenderableTreeNodes;
  userReads: UserUpdateRead[];
};

interface UpdateTimelineItemProps {
  update: UpdateWithParsedContent;
}

export function UpdateTimelineItem({ update }: UpdateTimelineItemProps) {
  const isUnread = update.userReads.length === 0;
  const itemRef = useRef<HTMLDivElement>(null);
  const hasTrackedView = useRef(false);
  const fetcher = useFetcher({ key: `mark-update-read-${update.id}` });

  // Track when update becomes visible (scroll-based read tracking)
  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && !hasTrackedView.current) {
        hasTrackedView.current = true;
        // Submit with this update's own fetcher
        void fetcher.submit(
          { intent: "markAsRead", updateId: update.id },
          { method: "POST", action: "/api/updates" }
        );
      }
    },
    [update.id, fetcher]
  );

  useEffect(() => {
    if (!isUnread || hasTrackedView.current) return;

    const observer = new IntersectionObserver(handleIntersection, {
      threshold: 0.5, // 50% visible
    });

    if (itemRef.current) {
      observer.observe(itemRef.current);
    }

    return () => observer.disconnect();
  }, [isUnread, handleIntersection]);

  return (
    <div
      ref={itemRef}
      className="grid grid-cols-1 gap-4 md:grid-cols-[200px_40px_1fr] md:gap-6"
    >
      {/* Left: Date/Time - shows on top on mobile, sticky on desktop */}
      <div className="text-left md:sticky md:top-4 md:self-start md:pb-16 md:text-right">
        <div className="text-sm font-medium text-gray-900">
          <DateS
            date={update.publishDate}
            options={{ month: "long", day: "numeric", year: "numeric" }}
          />
        </div>
        <div className="mt-1 text-sm text-gray-600">
          <DateS date={update.publishDate} onlyTime />
        </div>
        {isUnread && (
          <div className="mt-3">
            <Badge color="#3B82F6">New</Badge>
          </div>
        )}
      </div>

      {/* Center: Timeline dot and line - hidden on mobile */}
      <div className="relative hidden flex-col items-center md:flex">
        <div
          className={tw(
            "z-10 size-3 rounded-full border-2 border-white shadow-sm",
            isUnread ? "bg-blue-500" : "bg-gray-400"
          )}
        />
        <div className="absolute top-3 h-full w-px bg-gray-200" />
      </div>

      {/* Right: Content */}
      <div className="pb-8 md:pb-12">
        <h2 className="mb-4 text-2xl font-bold leading-tight text-gray-900">
          {update.title}
        </h2>

        <div className="prose prose-gray max-w-none text-[15px] leading-relaxed text-gray-700">
          <MarkdownViewer content={update.content} />
        </div>

        {update.url && (
          <div className="mt-6">
            <a
              href={update.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                void fetcher.submit(
                  { intent: "trackClick", updateId: update.id },
                  { method: "POST", action: "/api/updates" }
                );
              }}
              className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline"
            >
              Learn more
              <ExternalLinkIcon className="size-4" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
