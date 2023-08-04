import type { ActionArgs, LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import type Stripe from "stripe";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/shared/tabs";
import { Prices } from "~/components/subscription/prices";

import { requireAuthSession } from "~/modules/auth";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  getDomainUrl,
  getStripePricesAndProducts,
  createStripeCheckoutSession,
} from "~/utils/stripe.server";

export const action = async ({ request }: ActionArgs) => {
  const { userId } = await requireAuthSession(request);
  const formData = await request.formData();
  const priceId = formData.get("priceId") as Stripe.Price["id"];

  const stripeRedirectUrl = await createStripeCheckoutSession({
    userId,
    priceId,
    domainUrl: getDomainUrl(request),
  });
  return redirect(stripeRedirectUrl);
};

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);

  return json({
    title: "Subscription",
    subTitle: "Pick an account plan that fits your workflow.",
    prices: await getStripePricesAndProducts(),
  });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function UserPage() {
  const { title, subTitle, prices } = useLoaderData<typeof loader>();
  return (
    <div className=" flex flex-col">
      <div className="mb-6 flex justify-between border-b pb-5">
        <div>
          <h3 className="text-text-lg font-semibold">{title}</h3>
          <p className="text-sm text-gray-600">{subTitle}</p>
        </div>
      </div>

      <Tabs defaultValue="month" className="w-full">
        <TabsList>
          <TabsTrigger value="month">Montly</TabsTrigger>
          <TabsTrigger value="year">Yearly</TabsTrigger>
        </TabsList>
        <TabsContent value="month">
          <Prices prices={prices["month"]} />
        </TabsContent>
        <TabsContent value="year">
          <Prices prices={prices["year"]} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
