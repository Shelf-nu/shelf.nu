import { CustomFieldType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getImportMappingClient } from "./client.server";
import { buildColumnSamples, proposeByRules } from "./heuristics";
import type { ModelAnswer } from "./model.server";
import {
  proposeByModel,
  proposeMapping,
  reconcileModelAnswer,
} from "./model.server";
import {
  DAILY_MODEL_CALLS_PER_ORGANIZATION,
  resetModelCallUsage,
  tryConsumeModelCall,
} from "./usage.server";

// why: the Anthropic API is an external network call; tests drive its answers
vi.mock("./client.server", () => ({
  getImportMappingClient: vi.fn(),
}));

// why: keeps expected fallback warnings out of the test output
vi.mock("~/utils/logger", () => ({ Logger: { warn: vi.fn() } }));

const parse = vi.fn();
const mockedGetClient = vi.mocked(getImportMappingClient);

const FILE = [
  ["Item Name", "Ref", "Bought on", "Legacy ID"],
  ["Dell", "R-1", "2023-03-12", "X1"],
  ["HP", "R-2", "2023-04-01", "X2"],
  ["Lenovo", "R-3", "2023-05-01", "X3"],
  ["SECRET-ROW-4", "R-4", "2023-06-01", "X4"],
];

const { headers, samples } = buildColumnSamples(FILE);
const rulesProposal = proposeByRules(headers, samples, []);

/** A model answer covering every column of FILE. */
function answer(overrides: Partial<ModelAnswer> = {}): ModelAnswer {
  return {
    columns: [
      {
        source: "Item Name",
        target: { kind: "field", name: "title", type: "" },
        confidence: "high",
      },
      {
        source: "Ref",
        target: { kind: "customField", name: "Reference", type: "TEXT" },
        confidence: "low",
      },
      {
        source: "Bought on",
        target: { kind: "customField", name: "Purchase date", type: "DATE" },
        confidence: "high",
      },
      {
        source: "Legacy ID",
        target: { kind: "skip", name: "", type: "" },
        confidence: "high",
      },
    ],
    notes: [],
    ...overrides,
  };
}

beforeEach(() => {
  parse.mockReset();
  resetModelCallUsage();
  mockedGetClient.mockReturnValue({ messages: { parse } } as never);
});

describe("reconcileModelAnswer", () => {
  it("takes the model's answer per column", () => {
    const proposal = reconcileModelAnswer(answer(), rulesProposal, []);
    expect(proposal.source).toBe("model");
    expect(proposal.columns.map((column) => column.target)).toEqual([
      { kind: "field", name: "title" },
      { kind: "customField", name: "Reference", type: "TEXT" },
      { kind: "customField", name: "Purchase date", type: "DATE" },
      { kind: "skip" },
    ]);
    expect(proposal.columns[1].confidence).toBe("low");
    expect(proposal.columns[1].sample).toEqual(["R-1", "R-2", "R-3"]);
  });

  it("keeps the rules row for a column the model dropped or repeated", () => {
    const base = answer();
    const proposal = reconcileModelAnswer(
      answer({
        columns: [
          base.columns[1],
          base.columns[1],
          base.columns[2],
          base.columns[3],
        ],
      }),
      rulesProposal,
      []
    );
    expect(proposal.columns[0]).toEqual(rulesProposal.columns[0]);
    expect(proposal.columns[1]).toEqual(rulesProposal.columns[1]);
  });

  it("refuses barcodes without the add-on and keeps existing field types", () => {
    const base = answer();
    const proposal = reconcileModelAnswer(
      answer({
        columns: [
          base.columns[0],
          {
            source: "Ref",
            target: { kind: "field", name: "barcode_Code128", type: "" },
            confidence: "high",
          },
          base.columns[2],
          base.columns[3],
        ],
      }),
      rulesProposal,
      [{ name: "purchase DATE", type: CustomFieldType.TEXT }]
    );
    expect(proposal.columns[1].target).toEqual(rulesProposal.columns[1].target);
    expect(proposal.columns[2].target).toEqual({
      kind: "customField",
      name: "purchase DATE",
      type: "TEXT",
    });
  });

  it("gives a destination claimed twice to the first column only", () => {
    const base = answer();
    const proposal = reconcileModelAnswer(
      answer({
        columns: [
          base.columns[0],
          {
            source: "Ref",
            target: { kind: "field", name: "title", type: "" },
            confidence: "high",
          },
          base.columns[2],
          base.columns[3],
        ],
      }),
      rulesProposal,
      []
    );
    expect(proposal.columns[0].target).toEqual({
      kind: "field",
      name: "title",
    });
    expect(proposal.columns[1].target).toEqual({ kind: "skip" });
  });

  it("keeps the rules row for a target the importer cannot take", () => {
    const base = answer();
    const proposal = reconcileModelAnswer(
      answer({
        columns: [
          {
            source: "Item Name",
            target: { kind: "field", name: "serial", type: "" },
            confidence: "high",
          },
          {
            source: "Ref",
            target: { kind: "customField", name: "Ref", type: "WEIGHT" },
            confidence: "high",
          },
          base.columns[2],
          base.columns[3],
        ],
      }),
      rulesProposal,
      []
    );
    expect(proposal.columns[0]).toEqual(rulesProposal.columns[0]);
    expect(proposal.columns[1]).toEqual(rulesProposal.columns[1]);
  });

  it("caps and dedupes notes", () => {
    const proposal = reconcileModelAnswer(
      answer({ notes: ["a", "a", "b", "c", "d", "e", "f", " "] }),
      rulesProposal,
      []
    );
    expect(proposal.notes).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("proposeByModel", () => {
  const input = {
    headers,
    samples,
    existingCustomFields: [],
    rulesProposal,
    rowCount: 4,
    canUseBarcodes: false,
  };

  it("sends only headers, samples and counts to the model", async () => {
    parse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: answer(),
    });
    const proposal = await proposeByModel(input);

    expect(proposal.source).toBe("model");
    const request = parse.mock.calls[0][0];
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.max_tokens).toBe(2000);
    expect(request.output_config.effort).toBe("low");
    const message = request.messages[0].content as string;
    expect(message).toContain("Item Name");
    expect(message).not.toContain("SECRET-ROW-4");
  });

  it("falls back to the rules when the call throws", async () => {
    parse.mockRejectedValue(new Error("timeout"));
    await expect(proposeByModel(input)).resolves.toBe(rulesProposal);
  });

  it("falls back to the rules on a truncated or refused answer", async () => {
    parse.mockResolvedValue({ stop_reason: "max_tokens", parsed_output: null });
    await expect(proposeByModel(input)).resolves.toBe(rulesProposal);
    parse.mockResolvedValue({ stop_reason: "refusal", parsed_output: null });
    await expect(proposeByModel(input)).resolves.toBe(rulesProposal);
  });
});

describe("proposeMapping", () => {
  const args = {
    organizationId: "org-1",
    headers,
    samples,
    existingCustomFields: [],
    rowCount: 4,
    canUseBarcodes: false,
  };

  it("uses the rules only when no key is configured", async () => {
    mockedGetClient.mockReturnValue(null);
    const proposal = await proposeMapping(args);
    expect(proposal.source).toBe("rules");
    expect(parse).not.toHaveBeenCalled();
  });

  it("stops calling the model past the daily limit", async () => {
    parse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: answer(),
    });
    for (let call = 0; call < DAILY_MODEL_CALLS_PER_ORGANIZATION; call++) {
      await proposeMapping(args);
    }
    const proposal = await proposeMapping(args);
    expect(proposal.source).toBe("rules");
    expect(parse).toHaveBeenCalledTimes(DAILY_MODEL_CALLS_PER_ORGANIZATION);
    // Another workspace is unaffected.
    expect(
      (await proposeMapping({ ...args, organizationId: "org-2" })).source
    ).toBe("model");
  });
});

describe("tryConsumeModelCall", () => {
  it("starts a fresh count on the next UTC day", () => {
    const day1 = new Date("2026-10-16T23:59:00Z");
    for (let call = 0; call < DAILY_MODEL_CALLS_PER_ORGANIZATION; call++) {
      expect(tryConsumeModelCall("org", day1)).toBe(true);
    }
    expect(tryConsumeModelCall("org", day1)).toBe(false);
    expect(tryConsumeModelCall("org", new Date("2026-10-17T00:00:00Z"))).toBe(
      true
    );
  });
});
