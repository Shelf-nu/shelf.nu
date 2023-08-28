import type { V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useAtomValue } from "jotai";
import { titleAtom } from "~/atoms/custom-fields.new";

import { CustomFieldForm } from "~/components/custom-fields/form";
import Header from "~/components/layout/header";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";

const title = "New Custom Field";

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

export default function NewCustomFieldPage() {
  const title = useAtomValue(titleAtom);

  return (
    <>
      <Header title={title} />
      <div>
        <CustomFieldForm />
      </div>
    </>
  );
}
