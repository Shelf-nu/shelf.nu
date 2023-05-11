import maplibregl from "maplibre-gl";
import Map, { Marker } from "react-map-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ClientOnly } from "remix-utils";

export const ShelfMap = () => (
  <ClientOnly>
    {() => (
      <Map
        mapLib={maplibregl}
        initialViewState={{
          longitude: 16.62662018,
          latitude: 49.2125578,
          zoom: 14,
        }}
        style={{ width: "100%", height: "240px" }}
        mapStyle={`https://api.maptiler.com/maps/streets-v2/style.json?key=${window.env.MAPTILER_TOKEN}`}
      >
        <Marker longitude={16.62662018} latitude={49.2125578} anchor="bottom">
          <img src="/images/map-marker.png" width={40} />
        </Marker>
      </Map>
    )}
  </ClientOnly>
);
