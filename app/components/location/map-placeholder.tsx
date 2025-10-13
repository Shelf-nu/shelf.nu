import { tw } from "~/utils/tw";
import Icon from "../icons/icon";

export const MapPlaceholder = ({
  title = "Unable to generate map",
  description = "Scanner did not grant location permissions. You can see other data related to the last scan below.",
}: {
  title?: string;
  description?: string;
}) => (
  <div className="rounded-md border-0 bg-white py-14">
    <div className="z-10 flex size-full flex-col items-center justify-center px-[15px] text-center md:px-[45px]">
      <div
        className={tw(
          "mb-4 border text-gray-500",
          "flex size-14 items-center justify-center rounded-md p-3 shadow"
        )}
      >
        <Icon disableWrap={true} icon="map" />
      </div>
      <div className="text-[18px] font-semibold text-gray-900">{title}</div>
      <p>{description}</p>
    </div>
  </div>
);
