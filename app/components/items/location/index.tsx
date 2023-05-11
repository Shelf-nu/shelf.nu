import { ShelfMap } from "./map";

// function ErrorBoundary() {
//   return <div>Map not available</div>;
// }

export interface MapProps {
  longitude: number;
  latitude: number;
}

export default function LocationDetails({ longitude, latitude }: MapProps) {
  return (
    <div className="mb-8 border lg:mb-0">
      <div className="overflow-hidden border-b">
        <ShelfMap longitude={longitude} latitude={latitude} />
      </div>
      <div className="p-4 text-center">
        <p className="mb-1 font-semibold text-gray-700">Arnhem, NL</p>
        <p className="gray-600 text-[12px]">
          {longitude} , {latitude}
        </p>
      </div>
    </div>
  );
}
