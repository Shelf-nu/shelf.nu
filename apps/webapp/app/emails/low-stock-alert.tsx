/**
 * Low Stock Alert Email Template
 *
 * Sent to every owner and admin of a workspace when a quantity-tracked asset's
 * available quantity crosses down to or below its minimum (`minQuantity`).
 * Reads "Out of stock" instead of "Low stock" when nothing is available.
 *
 * Tells the reader, without opening the app: what is low and how low, what took
 * it down, where the remaining stock sits, what is out with people, whether
 * other items are low too, what to do, and why they got the mail.
 *
 * The body is shared with the back-in-stock notice; this file supplies only the
 * heading, lead sentence, yellow box and preheader.
 *
 * @see {@link file://./components/stock-level-email.tsx} - shared layout
 * @see {@link file://./low-stock-copy.ts} - every sentence
 * @see {@link file://../modules/consumption-log/low-stock.server.ts} - trigger and loader
 */

import { render } from "@react-email/components";
import {
  StockLevelEmail,
  stockLevelEmailText,
  type StockLevelContent,
  type StockLevelEmailProps,
} from "./components/stock-level-email";
import {
  lowStockHeading,
  lowStockLead,
  preheader,
  restockNotice,
} from "./low-stock-copy";

/** Props of the low-stock alert: one recipient's facts. */
export type LowStockAlertProps = StockLevelEmailProps;

/** Heading, lead, yellow box and preheader of the alert. */
function alertContent(props: LowStockAlertProps): StockLevelContent {
  return {
    heading: lowStockHeading(props.available),
    lead: lowStockLead(props),
    notice: restockNotice(props.minQuantity, props.unitOfMeasure),
    preview: preheader(props),
  };
}

/**
 * Renders one recipient's low-stock alert as HTML.
 *
 * @param props - The recipient and the facts to print
 * @returns Promise resolving to the rendered HTML string
 */
export const lowStockAlertHtml = (props: LowStockAlertProps) =>
  render(<StockLevelEmail content={alertContent(props)} facts={props} />);

/**
 * Renders one recipient's low-stock alert as plain text.
 *
 * @param props - The recipient and the facts to print
 * @returns Plain-text email body
 */
export const lowStockAlertText = (props: LowStockAlertProps) =>
  stockLevelEmailText({ content: alertContent(props), facts: props });
