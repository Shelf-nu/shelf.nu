/**
 * @file Amber notice listing the records an import will create automatically.
 *
 * Shared by the content import preview and the bulk update preview so both
 * warn about possible typos in the same way.
 *
 * @see {@link file://./../bulk-update/preview-display.tsx} Update-flow consumer
 */
import { AlertIcon } from "../../icons/library";

/** One kind of record the import creates, with the names it creates. */
export type NewEntityList = {
  /** Heading for the list, e.g. "New categories". */
  label: string;
  /** Names of the records that do not exist yet. */
  names: string[];
};

/**
 * Renders the "New items will be created" notice.
 *
 * @param props.entities - One list per kind of record. Empty lists are skipped.
 * @returns The notice, or `null` when every list is empty
 */
export function NewEntitiesNotice({ entities }: { entities: NewEntityList[] }) {
  const nonEmpty = entities.filter((entity) => entity.names.length > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-4">
      <p className="mb-2 font-medium text-amber-800">
        <AlertIcon className="inline-block size-4" /> New items will be created
      </p>
      <p className="mb-2 text-sm text-amber-700">
        The following items don't exist yet and will be created automatically.
        Please check for typos:
      </p>
      <div className="space-y-1 text-sm text-amber-800">
        {nonEmpty.map((entity) => (
          <p key={entity.label}>
            <strong>{entity.label}:</strong>{" "}
            {entity.names.map((name, i) => (
              // A name is unique within its own list (deduplicated upstream),
              // so it is a stable key here.
              <span key={name}>
                {i > 0 && ", "}
                <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
                  {name}
                </span>
              </span>
            ))}
          </p>
        ))}
      </div>
    </div>
  );
}
