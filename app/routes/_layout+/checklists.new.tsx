import { json } from "@remix-run/node";
import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { useAtomValue } from "jotai";
import { titleAtom } from "~/atoms/checklists.new";
import { NewChecklistForm } from "~/components/checklists/form";
import Header from "~/components/layout/header";
import { requireAuthSession } from "~/modules/auth";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

const title = "New Checklist";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);
  const header = {
    title,
  };
  return json({ header });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data.header.title) },
];

export const handle = {
  breadcrumb: () => <span>{title}</span>,
};

export default function NewCheclist() {
  const title = useAtomValue(titleAtom);
  return (
    <>
      <Header title={title} />
      <div>
        <NewChecklistForm />
      </div>
    </>
  );
}
