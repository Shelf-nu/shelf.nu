/**
 * Import mapping: the single entry point that proposes a mapping for a file.
 *
 * Today it returns the rule-based proposal. Another proposer (for example one
 * that refines low-confidence columns) plugs in through `refine`: it receives
 * the rules proposal and must return a complete `MappingProposal` for the same
 * columns, so the route and the review table stay unchanged.
 *
 * @see {@link file://./heuristics.ts} the rule-based proposal
 * @see {@link file://./../../routes/_layout+/assets.import.tsx} the caller
 */
import type { ExistingCustomField } from "./heuristics";
import { proposeByRules } from "./heuristics";
import type { MappingProposal } from "./types";

/** Everything known about one upload when a mapping is proposed. */
export type ProposeMappingInput = {
  /** Trimmed headers, in file order. */
  headers: string[];
  /** Sample cells per column, aligned with `headers`. */
  samples: string[][];
  /** The workspace's non-deleted custom fields. */
  existingCustomFields: ExistingCustomField[];
  /** Data rows in the file. */
  rowCount: number;
  /** Whether the workspace has the barcode add-on. */
  canUseBarcodes: boolean;
};

/**
 * Improves on a proposal. Must return one mapping per input column, in file
 * order, and must fall back to `rulesProposal` itself rather than throw.
 */
export type MappingRefiner = (
  input: ProposeMappingInput & { rulesProposal: MappingProposal }
) => Promise<MappingProposal>;

/**
 * Proposes a mapping for one upload: the rules, then `refine` when given.
 *
 * @param input - See {@link ProposeMappingInput}
 * @param refine - Optional second proposer, see {@link MappingRefiner}
 * @returns The proposal to show in the review table
 */
export async function proposeMapping(
  input: ProposeMappingInput,
  refine?: MappingRefiner
): Promise<MappingProposal> {
  const rulesProposal = proposeByRules(
    input.headers,
    input.samples,
    input.existingCustomFields,
    { canUseBarcodes: input.canUseBarcodes }
  );
  return refine ? refine({ ...input, rulesProposal }) : rulesProposal;
}
