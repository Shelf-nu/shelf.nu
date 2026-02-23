import { useLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/dashboard";
import { StarsIcon } from "../icons/library";
import { MarkdownViewer } from "../markdown/markdown-viewer";
import { Button } from "../shared/button";

export default function AnnouncementBar() {
  const { announcement } = useLoaderData<typeof loader>();
  return announcement ? (
    <div className="mb:gap-4 mb:p-4 mb-4 mt-3 flex items-center gap-2 rounded border border-gray-200 px-2 py-3">
      <div className="inline-flex items-center justify-center rounded-full border-[6px] border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
        <StarsIcon />
      </div>
      <div className="flex-1 items-center gap-1.5 xl:flex">
        <div>
          <MarkdownViewer content={announcement.content} />
        </div>
      </div>
      <Button variant="primary" to={announcement.link} className="">
        {announcement.linkText}
      </Button>
      {/* <Button variant="secondary" className="border-none bg-transparent">
        <XIcon />
      </Button> */}
    </div>
  ) : null;
}
