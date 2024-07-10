import { MapIcon } from "~/components/icons/library";
import { tw } from "~/utils/tw";

export const MapPlaceholder = ({
  title = "Unable to generate map",
  description = "Scanner did not grant location permissions. You can see other data related to the last scan below.",
}: {
  title?: string;
  description?: string;
}) => (
  <div className="relative">
    <img
      src="/static/images/no-location-image.jpg"
      alt="No scanned location"
      className="w-full rounded-none"
    />
    <div className="absolute top-0 z-10 flex size-full flex-col items-center justify-center px-[15px] text-center md:px-[45px]">
      <div
        className={tw(
          "border-error-50 bg-error-100 text-error-600",
          " flex size-14 items-center justify-center rounded-full"
        )}
      >
        <MapIcon />
      </div>
      <h4>{title}</h4>
      <p>{description}</p>
    </div>
  </div>
);
