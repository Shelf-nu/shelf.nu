/**
 * Editing an OPTION field's choices: ordering, duplicate merging, and the
 * rename pairs a save sends so every asset follows its option.
 *
 * @see {@link file://./option-list.ts}
 */
import { describe, expect, it } from "vitest";

import type { OptionListAction, OptionListState } from "./option-list";
import {
  buildOptionRenames,
  createOptionListState,
  findDuplicateGroups,
  mergeDuplicates,
  normalizeOptionKey,
  optionListReducer,
  resolveOptionRename,
  sortOptionsAlphabetically,
  summarizeOptionUsage,
} from "./option-list";

const values = (state: { rows: { value: string }[] }) =>
  state.rows.map((row) => row.value);

const keyOf = (state: OptionListState, value: string) => {
  const row = state.rows.find((r) => r.value === value);
  if (!row) throw new Error(`no row "${value}"`);
  return row.key;
};

function edit(
  saved: string[],
  ...steps: ((s: OptionListState) => OptionListAction)[]
) {
  return steps.reduce(
    (state, step) => optionListReducer(state, step(state)),
    createOptionListState(saved)
  );
}

const renamesOf = (state: OptionListState) =>
  buildOptionRenames(state.rows, state.merged);

describe("normalizeOptionKey", () => {
  it("ignores case, surrounding space and repeated inner space", () => {
    expect(normalizeOptionKey("  Sony   Pictures ")).toBe("sony pictures");
    expect(normalizeOptionKey("ÉCLAIR")).toBe("éclair");
  });
});

describe("sortOptionsAlphabetically", () => {
  it("sorts case-insensitively, by number value, and keeps ties in order", () => {
    const { rows } = createOptionListState([
      "banana",
      "Item 10",
      "apple",
      "Item 2",
      "Apple",
      " Cherry",
    ]);

    expect(values({ rows: sortOptionsAlphabetically(rows) })).toEqual([
      "apple",
      "Apple",
      "banana",
      " Cherry",
      "Item 2",
      "Item 10",
    ]);
  });

  it("files accented letters with their base letter", () => {
    const { rows } = createOptionListState(["Zebra", "Éclair", "eagle"]);

    expect(values({ rows: sortOptionsAlphabetically(rows) })).toEqual([
      "eagle",
      "Éclair",
      "Zebra",
    ]);
  });
});

describe("findDuplicateGroups", () => {
  it("groups rows that read as the same choice, in first-appearance order", () => {
    const { rows } = createOptionListState([
      "Sony",
      "Canon",
      "sony",
      "ARRI",
      "Sony ",
      "Canon",
    ]);

    expect(
      findDuplicateGroups(rows).map((group) => group.map((r) => r.value))
    ).toEqual([
      ["Sony", "sony", "Sony "],
      ["Canon", "Canon"],
    ]);
  });
});

describe("mergeDuplicates", () => {
  it("keeps the first spelling in its position and reports where the rest went", () => {
    const { rows } = createOptionListState([
      "Canon",
      "Sony",
      "ARRI",
      "sony",
      "canon",
    ]);
    const [canon, sony] = rows;

    const result = mergeDuplicates(rows);

    expect(values(result)).toEqual(["Canon", "Sony", "ARRI"]);
    expect(
      result.removed.map(({ row, intoKey }) => [row.value, intoKey])
    ).toEqual([
      ["canon", canon.key],
      ["sony", sony.key],
    ]);
  });
});

describe("buildOptionRenames", () => {
  it("sends nothing when the order changes but no spelling does", () => {
    const state = edit(["Large", "Small", "Medium"], () => ({ type: "sort" }));

    expect(values(state)).toEqual(["Large", "Medium", "Small"]);
    expect(renamesOf(state)).toEqual([]);
  });

  it("moves a renamed option's assets to the new spelling", () => {
    const state = edit(["Sony", "Canon"], (s) => ({
      type: "rename",
      key: keyOf(s, "Sony"),
      value: "Sony Pictures",
    }));

    expect(renamesOf(state)).toEqual([{ from: "Sony", to: "Sony Pictures" }]);
  });

  it("maps a merged duplicate and a renamed keeper onto the same final option", () => {
    const state = edit(
      ["Sony ", "Canon", "sony"],
      () => ({ type: "mergeDuplicates" }),
      (s) => ({ type: "rename", key: keyOf(s, "Sony "), value: "Sony" })
    );

    expect(values(state)).toEqual(["Sony", "Canon"]);
    expect(renamesOf(state)).toEqual([
      { from: "Sony ", to: "Sony" },
      { from: "sony", to: "Sony" },
    ]);
  });

  it("sends nothing for exact duplicates merged together", () => {
    const state = edit(["Sony", "Canon", "Sony"], () => ({
      type: "mergeDuplicates",
    }));

    expect(values(state)).toEqual(["Sony", "Canon"]);
    expect(renamesOf(state)).toEqual([]);
  });

  it("swaps two spellings in one save", () => {
    const state = edit(
      ["Small", "Large"],
      (s) => ({ type: "rename", key: keyOf(s, "Small"), value: "tmp" }),
      (s) => ({ type: "rename", key: keyOf(s, "Large"), value: "Small" }),
      (s) => ({ type: "rename", key: keyOf(s, "tmp"), value: "Large" })
    );

    expect(renamesOf(state)).toEqual([
      { from: "Small", to: "Large" },
      { from: "Large", to: "Small" },
    ]);
  });

  it("sends nothing for a deleted option, or for duplicates merged into it", () => {
    const state = edit(
      ["Sony", "sony", "Canon"],
      () => ({ type: "mergeDuplicates" }),
      (s) => ({ type: "remove", key: keyOf(s, "Sony") })
    );

    expect(values(state)).toEqual(["Canon"]);
    expect(renamesOf(state)).toEqual([]);
  });

  it("carries earlier merges along when their keeper is merged away later", () => {
    const state = edit(
      ["Sony", "sony"],
      () => ({ type: "mergeDuplicates" }),
      () => ({ type: "add", key: "new-row", value: "SONY" }),
      (s) => ({ type: "reorder", rows: [s.rows[1], s.rows[0]] }),
      () => ({ type: "mergeDuplicates" })
    );

    expect(values(state)).toEqual(["SONY"]);
    expect(renamesOf(state)).toEqual([
      { from: "sony", to: "SONY" },
      { from: "Sony", to: "SONY" },
    ]);
  });

  it("leaves exact duplicates' assets on the copy that kept the spelling", () => {
    const renameFirstCopy = (s: OptionListState) =>
      ({ type: "rename", key: s.rows[0].key, value: "Canon EOS" }) as const;

    expect(renamesOf(edit(["Canon", "Canon"], renameFirstCopy))).toEqual([]);
    expect(
      renamesOf(
        edit(
          ["Canon", "Canon"],
          (s) => ({ type: "reorder", rows: [s.rows[1], s.rows[0]] }),
          renameFirstCopy
        )
      )
    ).toEqual([]);
  });

  it("keeps assets on a spelling that is typed again after its row was renamed", () => {
    const state = edit(
      ["Sony", "Canon"],
      (s) => ({
        type: "rename",
        key: keyOf(s, "Sony"),
        value: "Sony Pictures",
      }),
      () => ({ type: "add", key: "new-row", value: "Sony" })
    );

    expect(renamesOf(state)).toEqual([]);
  });

  it("sends nothing for an option renamed and then removed", () => {
    const state = edit(
      ["Sony", "Canon"],
      (s) => ({
        type: "rename",
        key: keyOf(s, "Sony"),
        value: "Sony Pictures",
      }),
      (s) => ({ type: "remove", key: keyOf(s, "Sony Pictures") })
    );

    expect(values(state)).toEqual(["Canon"]);
    expect(renamesOf(state)).toEqual([]);
  });

  it("drops a merge whose keeper is renamed and then removed", () => {
    const state = edit(
      ["Sony", "sony", "Canon"],
      () => ({ type: "mergeDuplicates" }),
      (s) => ({ type: "rename", key: keyOf(s, "Sony"), value: "Sony Group" }),
      (s) => ({ type: "remove", key: keyOf(s, "Sony Group") })
    );

    expect(values(state)).toEqual(["Canon"]);
    expect(renamesOf(state)).toEqual([]);
  });

  it("keeps a rename through a sort and its undo", () => {
    const state = edit(
      ["Sony", "Canon"],
      (s) => ({ type: "rename", key: keyOf(s, "Sony"), value: "Alpha" }),
      () => ({ type: "sort" }),
      () => ({ type: "undoSort" })
    );

    expect(values(state)).toEqual(["Alpha", "Canon"]);
    expect(renamesOf(state)).toEqual([{ from: "Sony", to: "Alpha" }]);
  });
});

describe("summarizeOptionUsage", () => {
  const usageOf = (state: OptionListState, counts: Record<string, number>) => {
    const usage = summarizeOptionUsage(state.rows, state.merged, counts);
    return state.rows.map((row) => [row.value, usage.get(row.key)]);
  };

  it("sums merged duplicates onto the keeper and counts the ones that change", () => {
    const state = edit(
      ["Sony ", "Canon", "sony"],
      () => ({ type: "mergeDuplicates" }),
      (s) => ({ type: "rename", key: keyOf(s, "Sony "), value: "Sony" })
    );

    expect(usageOf(state, { "Sony ": 3, sony: 2, Canon: 5 })).toEqual([
      ["Sony", { assets: 5, updating: 5 }],
      ["Canon", { assets: 5, updating: 0 }],
    ]);
  });

  it("counts assets of exact duplicates once", () => {
    const counts = { Sony: 4 };

    expect(usageOf(createOptionListState(["Sony", "Sony"]), counts)).toEqual([
      ["Sony", { assets: 4, updating: 0 }],
      ["Sony", { assets: 0, updating: 0 }],
    ]);
    expect(
      usageOf(
        edit(["Sony", "Sony"], () => ({ type: "mergeDuplicates" })),
        counts
      )
    ).toEqual([["Sony", { assets: 4, updating: 0 }]]);
  });

  it("credits an option typed again with the assets that kept its spelling", () => {
    const state = edit(
      ["Sony", "Canon"],
      (s) => ({ type: "remove", key: keyOf(s, "Sony") }),
      () => ({ type: "add", key: "new-row", value: "Sony" })
    );

    expect(usageOf(state, { Sony: 4 })).toEqual([
      ["Canon", { assets: 0, updating: 0 }],
      ["Sony", { assets: 4, updating: 0 }],
    ]);
  });
});

describe("optionListReducer", () => {
  it("undoes a sort until the next edit", () => {
    const sorted = edit(["b", "c", "a"], () => ({ type: "sort" }));
    expect(values(sorted)).toEqual(["a", "b", "c"]);

    expect(values(optionListReducer(sorted, { type: "undoSort" }))).toEqual([
      "b",
      "c",
      "a",
    ]);

    const editedAfterSort = optionListReducer(sorted, {
      type: "rename",
      key: keyOf(sorted, "a"),
      value: "A1",
    });
    expect(
      values(optionListReducer(editedAfterSort, { type: "undoSort" }))
    ).toEqual(["A1", "b", "c"]);
  });
});

describe("resolveOptionRename", () => {
  const { rows } = createOptionListState(["Sony", "Canon"]);
  const [sony] = rows;

  it("trims the new name", () => {
    expect(resolveOptionRename(rows, sony.key, "  Sony Pictures ")).toEqual({
      status: "rename",
      value: "Sony Pictures",
    });
  });

  it("lets a row change only its own case", () => {
    expect(resolveOptionRename(rows, sony.key, "SONY")).toEqual({
      status: "rename",
      value: "SONY",
    });
  });

  it("refuses a blank name", () => {
    expect(resolveOptionRename(rows, sony.key, "   ")).toEqual({
      status: "error",
      message: "Option cannot be empty",
    });
  });

  it("refuses a name another row already reads as", () => {
    expect(resolveOptionRename(rows, sony.key, " canon")).toEqual({
      status: "error",
      message: "Option already exists",
    });
  });
});
