import maplibregl from "maplibre-gl";
import { Marker, ScaleControl } from "react-map-gl";
import Map from "react-map-gl/maplibre";
import { ClientOnly } from "remix-utils/client-only";

export const ShelfMap = ({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}) => (
  <ClientOnly>
    {() => (
      <Map
        mapLib={maplibregl}
        initialViewState={{
          latitude: latitude,
          longitude: longitude,
          zoom: 15,
        }}
        style={{ width: "100%", height: "240px" }}
        mapStyle={`https://api.maptiler.com/maps/streets-v2/style.json?key=${window.env.MAPTILER_TOKEN}`}
      >
        <Marker longitude={longitude} latitude={latitude} anchor="bottom">
          <img src="/images/map-marker.png" width={30} alt="img" />
        </Marker>
        <ScaleControl />
      </Map>
    )}
  </ClientOnly>
);
