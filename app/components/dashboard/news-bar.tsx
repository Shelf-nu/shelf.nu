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
    <div className=" mb-4 flex items-center gap-4 rounded border border-gray-200 p-4">
      <div className="inline-flex items-center justify-center rounded-full border-[6px] border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
        <StarsIcon />
      </div>
      <div className="flex flex-1 items-center gap-1.5">
        <h6 className="mb-0 max-w-[50%] text-base font-semibold text-gray-900">
          {heading}
        </h6>
        <p className="text-base">{description}</p>
      </div>
      <Button variant="primary" to={url}>
        Read update
      </Button>
      <Button variant="secondary" className="border-none bg-none">
        <XIcon />
      </Button>
    </div>
  );
}
