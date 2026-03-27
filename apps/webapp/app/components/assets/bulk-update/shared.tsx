import type { ClientValidation } from "./helpers";

// ---------------------------------------------------------------------------
// Summary Pill (used in both preview and results)
// ---------------------------------------------------------------------------

export function SummaryPill({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: "blue" | "green" | "gray" | "red";
}) {
  const colorClasses = {
    blue: "bg-blue-100 text-blue-700",
    green: "bg-green-100 text-green-700",
    gray: "bg-gray-100 text-gray-700",
    red: "bg-red-100 text-red-700",
  };

  return (
    <span
      className={`rounded-full px-3 py-1 font-medium ${colorClasses[color]}`}
    >
      {count} {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Client Validation Feedback
// ---------------------------------------------------------------------------

export function ClientValidationFeedback({
  validation,
  fileName,
}: {
  validation: ClientValidation;
  fileName: string;
}) {
  return (
    <div className="mt-3 rounded-md border bg-gray-50 p-3 text-sm">
      <p className="mb-1 font-medium text-gray-700">
        File: <span className="font-normal">{fileName}</span>
      </p>
      <div className="flex items-center gap-4 text-gray-600">
        <span className="flex items-center gap-1">
          {validation.idColumnFound ? (
            <>
              <span className="text-green-600">✓</span>
              Matching by {validation.idColumnFound}
            </>
          ) : (
            <>
              <span className="text-red-500">✗</span>
              No identifier column found
            </>
          )}
        </span>
        <span>{validation.headerCount} columns</span>
        <span>{validation.rowCount} data rows</span>
      </div>
      {validation.warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {validation.warnings.map((w, i) => (
            <p key={i} className="text-amber-600">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Defected Headers Table (shown on import errors)
// ---------------------------------------------------------------------------

export function DefectedHeadersTable({
  data,
}: {
  data: { incorrectHeader: string; errorMessage: string }[];
}) {
  return (
    <table className="mt-4 w-full rounded-md border text-left text-sm">
      <thead className="bg-red-100 text-xs">
        <tr>
          <th scope="col" className="px-2 py-1">
            Unrecognized Header
          </th>
          <th scope="col" className="px-2 py-1">
            Error
          </th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.incorrectHeader}>
            <td className="px-2 py-1">{row.incorrectHeader}</td>
            <td className="px-2 py-1">{row.errorMessage}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
