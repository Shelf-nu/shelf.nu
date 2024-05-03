import { json } from "@remix-run/node";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";

import { useAtomValue } from "jotai";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import KitsForm from "~/components/kits/form";
import Header from "~/components/layout/header";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";

const header = {
  title: "Untitled kit",
};

export function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    return json(
      data({
        header,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason));
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>{header.title}</span>,
};

export default function CreateNewKit() {
  const title = useAtomValue(dynamicTitleAtom);

  return (
    <>
      <Header title={title ?? "Untitled kit"} />
      <KitsForm />
    </>
  );
}
