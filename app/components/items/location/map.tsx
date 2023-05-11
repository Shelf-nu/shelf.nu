import maplibregl from "maplibre-gl";
import Map, { Marker } from "react-map-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ClientOnly } from "remix-utils";
import type { MapProps } from ".";

export const ShelfMap = ({longitude, latitude}: MapProps) => (
  <ClientOnly>
    {() => (
      <Map
        mapLib={maplibregl}
        initialViewState={{
          longitude: longitude,
          latitude: latitude,
          zoom: 10,
        }}
        style={{ width: "100%", height: "240px" }}
        mapStyle={`https://api.maptiler.com/maps/streets-v2/style.json?key=${window.env.MAPTILER_TOKEN}`}
      >
        <Marker longitude={longitude} latitude={latitude} anchor="bottom">
          <img src="/images/map-marker.png" width={40} alt="img"/>
        </Marker>
      </Map>
    )}
  </ClientOnly>
);
