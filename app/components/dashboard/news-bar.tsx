import { StarsIcon, XIcon } from "../icons";
import { Button } from "../shared/button";

export default function NewsBar({
  heading,
  description,
  url,
}: {
  heading: String;
  description: String;
  url: String;
}) {
  return (
    <div className="mb:gap-4 mb:p-4 mb-4 flex items-center gap-2 rounded border border-gray-200 px-2 py-3">
      <div className="inline-flex items-center justify-center rounded-full border-[6px] border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
        <StarsIcon />
      </div>
      <div className="flex-1 items-center gap-1.5 xl:flex">
        <h6 className="mb-0 text-[14px] font-semibold text-gray-900 md:text-base xl:max-w-[50%]">
          {heading}
        </h6>
        <p className="text-[14px] md:text-base">{description}</p>
        <Button
          variant="primary"
          to={url}
          className="mt-4 block max-w-[120px] lg:hidden"
          width="auto"
        >
          Read update
        </Button>
      </div>
      <Button variant="primary" to={url} className="hidden lg:block">
        Read update
      </Button>
      <Button variant="secondary" className="border-none bg-transparent">
        <XIcon />
      </Button>
    </div>
  );
}
