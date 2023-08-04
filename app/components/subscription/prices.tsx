import { Form } from "@remix-run/react";
import type Stripe from "stripe";
import { Button } from "../shared";

export type PriceWithProduct = Stripe.Price & {
  product: Stripe.Product;
};

export const Prices = ({ prices }: { prices: PriceWithProduct[] }) => (
  <div className="flex justify-center gap-5">
    {prices.map((price) => (
      <Price key={price.id} price={price} />
    ))}
  </div>
);

export const Price = ({ price }: { price: PriceWithProduct }) => {
  console.log(price);
  return (
    <div key={price.id} className=" bg-gray-100 p-4">
      <div>
        <h3>{price.product.name}</h3>
      </div>
      {price.unit_amount ? (
        <>
          <div>
            {price.unit_amount / 100} {price.currency}
          </div>
          {price.recurring ? <div>per {price.recurring.interval}</div> : null}
        </>
      ) : null}
      <div>
        <Form method="post">
          <input type="hidden" name="priceId" value={price.id} />
          <Button type="submit">Get started</Button>
        </Form>
      </div>
    </div>
  );
};
