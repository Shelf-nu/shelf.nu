import type { V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useAtomValue } from "jotai";
import { titleAtom } from "~/atoms/locations.new";

import { LocationForm } from "~/components/locations/form";
import Header from "~/components/layout/header";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
const title = "New Location";

export async function loader() {
  const header = {
    title,
  };

  return json({ header });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>{title}</span>,
};

export default function NewAssetPage() {
  const title = useAtomValue(titleAtom);

  return (
    <>
      <Header title={title} />
      <div>
        <LocationForm />
      </div>
    </>
  );
}
