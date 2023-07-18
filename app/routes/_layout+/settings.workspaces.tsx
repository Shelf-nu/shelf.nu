import type { V2_MetaFunction } from "@remix-run/node";
import { Button } from "~/components/shared/button";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import type { loader } from "./assets._index";

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function WorkspacesPage() {
  return (
    <div>
      <div className="mb-6 flex justify-between border-b pb-5">
        <div>
          <h3 className="text-text-lg font-semibold">Workspace</h3>
          <p className="text-sm text-gray-600">Manage your workspace.</p>
        </div>
        <Button variant="primary">Save</Button>
      </div>
    </div>
  );
}
