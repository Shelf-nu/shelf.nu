/**
 * Constants safe to import from BOTH server and client portal code.
 * The .server.ts variant must not be imported from any default export
 * (client) of a route file — Vite refuses to bundle it.
 */

export const STATUS_LABEL = {
  DRAFT: "In attesa",
  RESERVED: "Approvata",
  ONGOING: "In corso",
  OVERDUE: "In ritardo",
  COMPLETE: "Completata",
  CANCELLED: "Rifiutata",
  ARCHIVED: "Archiviata",
} as const;

export const STATUS_TONE = {
  DRAFT: "warning",
  RESERVED: "success",
  ONGOING: "secondary",
  OVERDUE: "error",
  COMPLETE: "neutral",
  CANCELLED: "error",
  ARCHIVED: "neutral",
} as const;
