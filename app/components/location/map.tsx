import maplibregl from "maplibre-gl";
// https://github.com/visgl/react-map-gl/issues/2272
import * as Map from "react-map-gl/dist/es5/exports-maplibre.js";
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
      <Map.Map
        mapLib={maplibregl}
        initialViewState={{
          latitude: latitude,
          longitude: longitude,
          zoom: 15,
        }}
        style={{
          width: "100%",
          height: "240px",
          borderTopLeftRadius: "6px",
          borderTopRightRadius: "6px",
        }}
        mapStyle={`https://api.maptiler.com/maps/streets-v2/style.json?key=${window.env.MAPTILER_TOKEN}`}
      >
        <Map.Marker longitude={longitude} latitude={latitude} anchor="bottom">
          <img src="/static/images/map-marker.png" width={30} alt="img" />
        </Map.Marker>
        <Map.ScaleControl />
      </Map.Map>
    )}
  </ClientOnly>
);
