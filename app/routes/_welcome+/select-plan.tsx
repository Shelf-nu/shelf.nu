import { useMemo, useState } from "react";
import {
  json,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { Form } from "~/components/custom-form";
import { CrispButton } from "~/components/marketing/crisp";
import { Button } from "~/components/shared/button";
import { PriceBox } from "~/components/subscription/price-box";
import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import type { CustomerWithSubscriptions } from "~/utils/stripe.server";
import {
  getStripeCustomer,
  getStripePricesAndProducts,
} from "~/utils/stripe.server";
import { tw } from "~/utils/tw";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Welcome to shelf.nu") },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.subscription,
      action: PermissionAction.read,
    });

    const user = await getUserByID(userId);

    /** Get the Stripe customer */
    const customer = user.customerId
      ? ((await getStripeCustomer(
          user.customerId
        )) as CustomerWithSubscriptions)
      : null;

    /* Get the prices and products from Stripe */
    const prices = await getStripePricesAndProducts();

    return json(
      data({
        title: "Subscription",
        subTitle: "Pick an account plan that fits your workflow.",
        /** Filter out the montly and yearly prices to only have prices for team plan */
        prices: [
          ...prices.month.filter(
            (price) => price.product.metadata.shelf_tier === "tier_2"
          ),
          ...prices.year.filter(
            (price) => price.product.metadata.shelf_tier === "tier_2"
          ),
        ],
        customer,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function SelectPlan() {
  const { prices } = useLoaderData<typeof loader>();
  const [selectedPlan, setSelectedPlan] = useState<"year" | "month" | null>(
    "year"
  );
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state) || !selectedPlan;

  const activePrice = useMemo(
    () => prices.find((price) => price.recurring?.interval === selectedPlan),
    [selectedPlan, prices]
  );

  return (
    <div className="flex flex-col items-center p-4 sm:p-6">
      <img
        src="/static/images/shelf-symbol.png"
        alt="logo"
        className="my-4 md:mt-0"
        width={32}
        height={32}
      />
      <div className="mb-8 text-center">
        <h3>Select your payment plan</h3>
        <p>No credit card or payment required.</p>
      </div>

      <div className="mb-8 flex w-full flex-col items-stretch gap-3 md:flex-row [&_.price-box]:!mb-0 [&_.price-box]:py-4 [&_.price-slogan]:hidden">
        {prices.map((price) => (
          <PlanBox
            key={price.id}
            plan={price.recurring?.interval as "month" | "year"}
            selectedPlan={selectedPlan}
            setSelectedPlan={() =>
              setSelectedPlan(price.recurring?.interval as "month" | "year")
            }
          >
            <PriceBox
              price={price}
              activePlan={undefined}
              subscription={null}
              isTrialSubscription={false}
              customPlanName={
                price.recurring?.interval === "year" ? (
                  <div className="text-center">
                    Yearly{" "}
                    <span className="block rounded-[16px] bg-primary-100 px-2 py-1 text-xs font-medium text-primary-700">
                      Save 54%
                    </span>
                  </div>
                ) : (
                  <div className="text-center">
                    Monthly <span className="block h-6"></span>
                  </div>
                )
              }
            />
          </PlanBox>
        ))}
      </div>
      <p className="mb-4 text-[12px] text-gray-600">
        You will not be directly billed. When the trial period has ended your
        subscription will be paused until you decide to continue. You can always
        change your plan at a later point in time. No long term contracts. Need
        help?{" "}
        <CrispButton
          variant="link"
          title="Questions/Feedback"
          className="text-[12px]"
        >
          Contact Support
        </CrispButton>
        .
      </p>
      <Form
        method="post"
        className="w-full"
        action="/account-details/subscription"
      >
        <input type="hidden" name="priceId" value={activePrice?.id || ""} />
        <input
          type="hidden"
          name="shelfTier"
          value={activePrice?.product.metadata.shelf_tier}
        />

        <Button
          width="full"
          type="submit"
          name="intent"
          value="trial"
          disabled={disabled}
        >
          Start 14 day free trial
        </Button>
      </Form>
    </div>
  );
}

const PlanBox = ({
  plan,
  children,
  selectedPlan,
  setSelectedPlan,
  ...rest
}: {
  plan: "month" | "year";
  children: React.ReactNode;
  selectedPlan: "month" | "year" | null;
  setSelectedPlan: (plan: "month" | "year") => void;
  [key: string]: any;
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const selected = selectedPlan === plan;
  const activeClasses =
    "[&_.price-box]:!border-primary [&_.price-box]:!bg-primary-50 [&_h5]:!text-primary-800";
  return (
    <div
      onClick={() => setSelectedPlan(plan)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={tw(
        "h-full transition-colors hover:cursor-pointer md:w-1/2 [&_.price-box]:!mb-4",
        selected || isHovered ? activeClasses : "",
        rest.className
      )}
    >
      {children}
    </div>
  );
};
