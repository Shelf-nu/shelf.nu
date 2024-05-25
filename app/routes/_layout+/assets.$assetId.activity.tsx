import type { MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Notes } from "~/components/assets/notes";
import TextualDivider from "~/components/shared/textual-divider";
import { useUserIsSelfService } from "~/hooks/user-user-is-self-service";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { data } from "~/utils/http.server";
export function loader() {
  const title = "Asset Activity";

  return json(data({ title }));
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export const handle = {
  breadcrumb: () => "Activity",
};

export default function AssetActivity() {
  const isSelfService = useUserIsSelfService();
  return (
    <div className="w-full">
      {isSelfService ? (
        <div className="flex h-full flex-col justify-center">
          <div className="flex flex-col items-center justify-center  text-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={56}
              height={56}
              fill="none"
            >
              <rect width={48} height={48} x={4} y={4} fill="#FDEAD7" rx={24} />
              <rect
                width={48}
                height={48}
                x={4}
                y={4}
                stroke="#FEF6EE"
                strokeWidth={8}
                rx={24}
              />
              <path
                stroke="#EF6820"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="m26 31-3.075 3.114c-.43.434-.644.651-.828.667a.5.5 0 0 1-.421-.173c-.12-.14-.12-.446-.12-1.056v-1.56c0-.548-.449-.944-.99-1.024v0a3 3 0 0 1-2.534-2.533C18 28.219 18 27.96 18 27.445V22.8c0-1.68 0-2.52.327-3.162a3 3 0 0 1 1.311-1.311C20.28 18 21.12 18 22.8 18h7.4c1.68 0 2.52 0 3.162.327a3 3 0 0 1 1.311 1.311C35 20.28 35 21.12 35 22.8V27m0 11-2.176-1.513c-.306-.213-.46-.32-.626-.395a2.002 2.002 0 0 0-.462-.145c-.18-.033-.367-.033-.74-.033H29.2c-1.12 0-1.68 0-2.108-.218a2 2 0 0 1-.874-.874C26 34.394 26 33.834 26 32.714V30.2c0-1.12 0-1.68.218-2.108a2 2 0 0 1 .874-.874C27.52 27 28.08 27 29.2 27h5.6c1.12 0 1.68 0 2.108.218a2 2 0 0 1 .874.874C38 28.52 38 29.08 38 30.2v2.714c0 .932 0 1.398-.152 1.766a2 2 0 0 1-1.083 1.082c-.367.152-.833.152-1.765.152V38Z"
              />
            </svg>
            <h5>Insufficient permissions</h5>
            <p>You are not allowed to view asset notes</p>
          </div>
        </div>
      ) : (
        <>
          <TextualDivider text="Notes" className="mb-8 lg:hidden" />
          <Notes />
        </>
      )}
    </div>
  );
}
