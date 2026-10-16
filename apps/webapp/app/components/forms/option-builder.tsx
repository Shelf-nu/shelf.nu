/**
 * Option Builder
 *
 * Edits the choices of an OPTION custom field in Settings > Custom fields:
 * add, reorder by drag or Alt+Arrow keys, Sort A-Z (undoable until the next
 * edit), rename in place, merge legacy duplicates, and remove. Nothing is stored
 * until the surrounding form is saved; the builder renders the hidden inputs
 * that carry the final order and the rename pairs.
 *
 * @see {@link file://./../../modules/custom-field/option-list.ts}
 * @see {@link file://./../custom-fields/form.tsx}
 */
import type { Dispatch, KeyboardEvent } from "react";
import { Fragment, useId, useRef, useState } from "react";
import { CrossCircledIcon } from "@radix-ui/react-icons";
import { Reorder, useDragControls } from "framer-motion";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useKeyboardReorder } from "~/hooks/use-keyboard-reorder";
import type {
  OptionListAction,
  OptionListState,
  OptionRenameResolution,
  OptionRow,
  OptionUsage,
} from "~/modules/custom-field/option-list";
import {
  buildOptionRenames,
  findDuplicateGroups,
  normalizeOptionKey,
  resolveOptionRename,
  sortOptionsAlphabetically,
  summarizeOptionUsage,
} from "~/modules/custom-field/option-list";
import { generateClientId } from "~/utils/id/client-id";
import { tw } from "~/utils/tw";
import Input from "./input";
import { HandleIcon, PenIcon } from "../icons/library";
import { Button } from "../shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../shared/modal";

interface Props {
  /**
   * The rows being edited. Owned by the form (`optionListReducer`) so they
   * survive the builder unmounting when another field type is picked.
   */
  state: OptionListState;
  dispatch: Dispatch<OptionListAction>;
  /** Assets per stored spelling. Absent for a new field. */
  usageCounts?: Record<string, number>;
  /** Form field name of the option at `index`. */
  optionName: (index: number) => string;
  /** Form field name of one side of the rename pair at `index`. */
  renameName: (index: number, side: "from" | "to") => string;
}

/** What pressing enter in the option builder should do with the typed text. */
export type OptionEntryResolution =
  | { status: "add"; option: string }
  | { status: "duplicate" }
  | { status: "ignore" };

/**
 * Decides whether typed text becomes an option, trimming it on the way in.
 *
 * Trimming belongs here rather than at save time: this is the only point that
 * sees an option before anything stores it. An option IS the string an asset
 * keeps in `AssetCustomFieldValue`, validated later by exact membership, so
 * rewriting one outside a rename would orphan the assets pointing at it.
 *
 * Duplicates are compared with {@link normalizeOptionKey}, the same rule as
 * renames and "Merge duplicates", so "sony" cannot be added next to "Sony".
 *
 * @param raw - The text currently in the input.
 * @param options - The options already added.
 * @returns Whether to add (with the text to add), report a duplicate, or do
 *   nothing at all.
 */
export function resolveOptionEntry(
  raw: string,
  options: string[]
): OptionEntryResolution {
  const option = raw.trim();

  if (!option) {
    return { status: "ignore" };
  }

  const key = normalizeOptionKey(option);
  if (options.some((existing) => normalizeOptionKey(existing) === key)) {
    return { status: "duplicate" };
  }

  return { status: "add", option };
}

const assetCount = (count: number) =>
  count === 1 ? "1 asset" : `${count} assets`;

function OptionBuilder({
  state: { rows, merged, beforeSort },
  dispatch,
  usageCounts,
  optionName,
  renameName,
}: Props) {
  const [entry, setEntry] = useState("");
  const [entryError, setEntryError] = useState("");
  const [pendingRemovalKey, setPendingRemovalKey] = useState<string | null>(
    null
  );
  const instructionsId = useId();

  const renames = buildOptionRenames(rows, merged);
  const usage = usageCounts
    ? summarizeOptionUsage(rows, merged, usageCounts)
    : null;
  const duplicateCount = findDuplicateGroups(rows).reduce(
    (count, group) => count + group.length - 1,
    0
  );
  const isSorted = sortOptionsAlphabetically(rows).every(
    (row, index) => row === rows[index]
  );
  const pendingRemoval = rows.find((row) => row.key === pendingRemovalKey);

  const reorder = (next: OptionRow[]) =>
    dispatch({ type: "reorder", rows: next });
  const { handleKeyDown, announcement, itemRefs } = useKeyboardReorder({
    items: rows,
    onReorder: reorder,
    getItemName: (row) => row.value,
  });

  function handleEntryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const result = resolveOptionEntry(
      entry,
      rows.map((row) => row.value)
    );
    if (result.status === "duplicate") {
      setEntryError("Option already exists");
    } else if (result.status === "add") {
      dispatch({ type: "add", key: generateClientId(), value: result.option });
      setEntry("");
      setEntryError("");
    }
  }

  function requestRemoval(row: OptionRow) {
    if ((usage?.get(row.key)?.assets ?? 0) > 0) {
      setPendingRemovalKey(row.key);
    } else {
      dispatch({ type: "remove", key: row.key });
    }
  }

  return (
    <div className="container flex-1 grow rounded border px-6 py-4 text-[14px] text-gray-600">
      <Input
        onChange={({ target }) => setEntry(target.value)}
        label="New option"
        value={entry}
        placeholder="Type an option here and press enter"
        className="w-full"
        error={entryError}
        hideLabel
        onKeyDown={handleEntryKeyDown}
      />

      {rows.length > 1 ? (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            Drag a handle, or focus it and press Alt+↑↓, to reorder
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {beforeSort ? (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => dispatch({ type: "undoSort" })}
              >
                Undo sort
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="xs"
              disabled={isSorted}
              onClick={() => dispatch({ type: "sort" })}
            >
              Sort A-Z
            </Button>
          </div>
        </div>
      ) : null}

      {duplicateCount > 0 ? (
        <div className="mt-3 flex items-start justify-between gap-3 rounded border border-warning-300 bg-warning-25 px-4 py-3 text-warning-700">
          <div>
            <p className="font-medium">
              {duplicateCount === 1
                ? "1 option is a duplicate of another"
                : `${duplicateCount} options are duplicates of others`}
            </p>
            <p className="text-xs">
              They differ only in capital letters or spaces. Merging keeps the
              first spelling, and their assets move to it when you save.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            className="shrink-0"
            onClick={() => dispatch({ type: "mergeDuplicates" })}
          >
            Merge duplicates
          </Button>
        </div>
      ) : null}

      <p id={instructionsId} className="sr-only">
        Focus a drag handle and press Alt plus arrow up or arrow down to move
        the option.
      </p>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>
      <Reorder.Group
        axis="y"
        values={rows}
        onReorder={reorder}
        as="ul"
        aria-label="Options"
      >
        {rows.map((row, index) => (
          <OptionListItem
            key={row.key}
            row={row}
            usage={usage?.get(row.key)}
            instructionsId={instructionsId}
            handleRef={(element) => {
              itemRefs.current[index] = element;
            }}
            onHandleKeyDown={(event) => handleKeyDown(event, index)}
            resolveRename={(raw) => resolveOptionRename(rows, row.key, raw)}
            onRename={(value) =>
              dispatch({ type: "rename", key: row.key, value })
            }
            onRemove={() => requestRemoval(row)}
          />
        ))}
      </Reorder.Group>

      {rows.map((row, index) => (
        <input
          key={row.key}
          type="hidden"
          name={optionName(index)}
          value={row.value}
        />
      ))}
      {renames.map(({ from, to }, index) => (
        <Fragment key={from}>
          <input type="hidden" name={renameName(index, "from")} value={from} />
          <input type="hidden" name={renameName(index, "to")} value={to} />
        </Fragment>
      ))}

      {pendingRemoval ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingRemovalKey(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Remove "{pendingRemoval.value}"?
              </AlertDialogTitle>
              <AlertDialogDescription>
                It is used on{" "}
                {assetCount(usage?.get(pendingRemoval.key)?.assets ?? 0)}. Those
                assets keep their current value, but it will no longer be one of
                the choices. To update them as well, rename the option instead.
                Nothing changes until you save the field.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </AlertDialogCancel>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  dispatch({ type: "remove", key: pendingRemoval.key });
                  setPendingRemovalKey(null);
                }}
              >
                Remove option
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}

/** One draggable option: handle, name (click to rename), usage, remove. */
function OptionListItem({
  row,
  usage,
  instructionsId,
  handleRef,
  onHandleKeyDown,
  resolveRename,
  onRename,
  onRemove,
}: {
  row: OptionRow;
  usage: OptionUsage | undefined;
  instructionsId: string;
  handleRef: (element: HTMLButtonElement | null) => void;
  onHandleKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  resolveRename: (raw: string) => OptionRenameResolution;
  onRename: (value: string) => void;
  onRemove: () => void;
}) {
  const dragControls = useDragControls();
  const [isEditing, setIsEditing] = useState(false);
  const nameRef = useRef<HTMLButtonElement>(null);
  const label = row.value.trim() ? row.value : "Empty option";

  function stopEditing(restoreFocus: boolean) {
    setIsEditing(false);
    if (restoreFocus) setTimeout(() => nameRef.current?.focus(), 0);
  }

  return (
    <Reorder.Item
      value={row}
      as="li"
      dragListener={false}
      dragControls={dragControls}
      className="relative mt-2 flex items-center gap-3 rounded border bg-white px-3 py-2 text-[14px] text-gray-600"
    >
      <button
        type="button"
        ref={handleRef}
        onPointerDown={(event) => dragControls.start(event)}
        onKeyDown={onHandleKeyDown}
        className="flex cursor-grab touch-none items-center p-1 text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Reorder ${label}`}
        aria-describedby={instructionsId}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        title="Drag to reorder or use Alt+Arrow keys"
      >
        <span className="block h-3 w-2">
          <HandleIcon />
        </span>
      </button>

      <div className="min-w-0 flex-1">
        {isEditing ? (
          <OptionRenameInput
            initialValue={row.value}
            label={`Rename ${label}`}
            resolve={resolveRename}
            onRename={onRename}
            onDone={stopEditing}
          />
        ) : (
          <button
            ref={nameRef}
            type="button"
            onClick={() => setIsEditing(true)}
            className="group flex max-w-full items-center gap-2 rounded text-left text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`Rename ${label}`}
            title="Click to rename"
          >
            <span
              className={
                row.value.trim() ? "truncate" : "truncate italic text-gray-400"
              }
            >
              {label}
            </span>
            <PenIcon className="size-3.5 shrink-0 text-gray-400 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
          </button>
        )}
        {usage && usage.assets > 0 ? (
          <p className="text-xs text-gray-500">
            Used on {assetCount(usage.assets)}
            {usage.updating > 0
              ? `. ${usage.updating} will be updated on save`
              : ""}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="rounded text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Remove ${label}`}
      >
        <CrossCircledIcon className="size-6" />
      </button>
    </Reorder.Item>
  );
}

/**
 * Inline rename field. Enter or leaving the field commits, Escape cancels. An
 * invalid name keeps the field open with its error.
 */
function OptionRenameInput({
  initialValue,
  label,
  resolve,
  onRename,
  onDone,
}: {
  initialValue: string;
  label: string;
  resolve: (raw: string) => OptionRenameResolution;
  onRename: (value: string) => void;
  onDone: (restoreFocus: boolean) => void;
}) {
  const inputRef = useAutoFocus<HTMLInputElement>();
  const [draft, setDraft] = useState(initialValue);
  const [error, setError] = useState("");
  const errorId = useId();
  // Removing the focused input on Enter or Escape fires one more blur; it must
  // not commit a second time or undo a cancel.
  const settled = useRef(false);

  function commit(restoreFocus: boolean) {
    const result = resolve(draft);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    settled.current = true;
    if (result.value !== initialValue) onRename(result.value);
    onDone(restoreFocus);
  }

  return (
    <div>
      <input
        ref={inputRef}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        value={draft}
        className={tw(
          "w-full rounded border border-gray-300 px-2 py-1 text-[14px] text-gray-900 outline-none focus:border-primary-300",
          error && "border-error-300 focus:border-error-300"
        )}
        onChange={(event) => {
          setDraft(event.target.value);
          setError("");
        }}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            settled.current = true;
            onDone(true);
          }
        }}
        onBlur={() => {
          if (!settled.current) commit(false);
        }}
      />
      {error ? (
        <p id={errorId} className="text-sm text-error-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default OptionBuilder;
