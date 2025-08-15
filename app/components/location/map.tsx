import { Map, Marker } from "pigeon-maps";
import { maptiler } from "pigeon-maps/providers";
import { ClientOnly } from "remix-utils/client-only";
import { MAPTILER_TOKEN } from "~/utils/env";

const mapProvider = maptiler(MAPTILER_TOKEN, "streets");

export const ShelfMap = ({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}) => (
  <ClientOnly>
    {() => (
      <div
        style={{
          width: "100%",
          height: "240px",
          borderTopLeftRadius: "6px",
          borderTopRightRadius: "6px",
          overflow: "hidden",
        }}
      >
        <Map
          height={240}
          center={[latitude, longitude]}
          zoom={15}
          provider={mapProvider}
        >
          <Marker anchor={[latitude, longitude]} width={30}>
            <img
              src="/static/images/map-marker.png"
              width={30}
              alt="Map marker"
            />
          </Marker>
        </Map>
      </div>
    )}
  </ClientOnly>
);
