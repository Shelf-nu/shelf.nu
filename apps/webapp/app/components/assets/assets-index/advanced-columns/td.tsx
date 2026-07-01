/**
 * Shared Td wrapper for advanced-asset-columns cells
 *
 * The advanced asset index uses a custom <Td> that adds `p-[2px]` on top of
 * the shared table `<Td>`. The wrapper lives here so extracted cell files
 * (e.g. `qr-id-cell.tsx`, `sam-id-cell.tsx`) render identical padding to
 * cells that still live inline in `advanced-asset-columns.tsx`.
 *
 * If you change the padding, change it once here — both inline cases and
 * extracted cells share this wrapper via re-import.
 */

import type { ComponentProps } from "react";
import { Td as BaseTd } from "~/components/table";
import { tw } from "~/utils/tw";

/**
 * Advanced-index Td wrapper — adds `p-[2px]` to BaseTd. Forwards all props.
 */
export function Td({ className, ...rest }: ComponentProps<typeof BaseTd>) {
  return <BaseTd className={tw("p-[2px]", className)} {...rest} />;
}
