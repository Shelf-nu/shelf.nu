import { ClientOnly } from "remix-utils";
import Map from "./map";

function ErrorBoundary() {
  return <div>Map not available</div>;
}

export default function LocationDetails() {
  return <ClientOnly fallback={<ErrorBoundary />}>{() => <Map />}</ClientOnly>;
}
