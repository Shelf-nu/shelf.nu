import { Button } from "../shared/button";
import type { IconType } from "../shared/icons-map";
import iconsMap from "../shared/icons-map";

interface Props {
  title: string;
  content: string;
  cta?: {
    to: string | undefined;
    text: string | undefined;
  };
  icon: IconType;
}

export default function BlockInteractions({
  title,
  content,
  cta = undefined,
  icon,
}: Props) {
  return (
    <div className="fixed z-[9999999] h-screen w-screen px-4 py-16 md:p-16">
      <img
        src="/static/images/bg-overlay1.png"
        alt="background"
        className="absolute left-0 top-0 -z-10 size-full object-cover"
      />
      <div className="flex size-full items-center justify-center bg-surface shadow-xl">
        <div className="max-w-[400px] p-6 text-center">
          <div className="bg-primary-100 mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 p-2 text-primary">
            {iconsMap[icon]}
          </div>
          <h1 className="text-[18px] font-semibold leading-7">{title}</h1>
          <p className="text-color-600">{content}</p>
          {cta?.to && cta?.text && (
            <Button
              to={cta.to}
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
              width="full"
              className="mt-8"
            >
              {cta.text}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
