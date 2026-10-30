/**
 * What `@shelf/links` knows about hosts, paths and file extensions, as data.
 * Internal: callers read it through `parseLink`, `linkChipText` and
 * `cleanLinkTitle`.
 */

import type { LinkKind, LinkProvider } from "./types";

type HostPattern = { readonly exact: string } | { readonly suffix: string };

type KindRule =
  /**
   * Office share links carry the item type as a one-letter path segment:
   * `/:b:/` on SharePoint and OneDrive for work, `/b/` on 1drv.ms.
   */
  | { readonly rule: "office-letter" }
  /** First matching path prefix wins. */
  | {
      readonly rule: "path-prefix";
      readonly prefixes: readonly (readonly [string, LinkKind])[];
    };

type NamedKind = Exclude<LinkKind, "page">;

interface ProviderSpec<P extends LinkProvider> {
  readonly id: P;
  /** Name shown on the chip. */
  readonly label: string;
  /** The most specific matching pattern across all providers wins. */
  readonly hosts: readonly HostPattern[];
  readonly kind: KindRule;
  /** The provider's own word for a kind, e.g. "Google Sheet". */
  readonly kindLabels?: Readonly<Partial<Record<NamedKind, string>>>;
  /** Text the provider puts before its page titles, removed for display. */
  readonly titlePrefixes?: readonly string[];
  /** Text the provider appends to its page titles, removed for display. */
  readonly titleSuffixes?: readonly string[];
}

type ProviderRegistry = {
  readonly [P in LinkProvider]: ProviderSpec<P>;
};

const OFFICE_KIND_LABELS = {
  document: "Word document",
  spreadsheet: "Excel workbook",
  presentation: "PowerPoint",
} as const;

/** Every recognised provider, keyed by id. */
export const PROVIDERS: ProviderRegistry = {
  onedrive: {
    id: "onedrive",
    label: "OneDrive",
    hosts: [
      { suffix: "-my.sharepoint.com" },
      { exact: "1drv.ms" },
      { exact: "onedrive.live.com" },
    ],
    kind: { rule: "office-letter" },
    kindLabels: OFFICE_KIND_LABELS,
  },
  sharepoint: {
    id: "sharepoint",
    label: "SharePoint",
    hosts: [{ suffix: ".sharepoint.com" }],
    kind: { rule: "office-letter" },
    kindLabels: OFFICE_KIND_LABELS,
  },
  "google-drive": {
    id: "google-drive",
    label: "Google Drive",
    hosts: [{ exact: "drive.google.com" }],
    kind: {
      rule: "path-prefix",
      prefixes: [
        ["/drive/folders/", "folder"],
        ["/drive/u/", "folder"],
        ["/file/d/", "file"],
        ["/open", "file"],
        ["/uc", "file"],
      ],
    },
    titleSuffixes: [" - Google Drive"],
  },
  "google-docs": {
    id: "google-docs",
    label: "Google Docs",
    hosts: [{ exact: "docs.google.com" }],
    kind: {
      rule: "path-prefix",
      prefixes: [
        ["/document/", "document"],
        ["/spreadsheets/", "spreadsheet"],
        ["/presentation/", "presentation"],
        ["/forms/", "form"],
        ["/file/d/", "file"],
      ],
    },
    kindLabels: {
      document: "Google Doc",
      spreadsheet: "Google Sheet",
      presentation: "Google Slides",
      form: "Google Form",
    },
  },
  dropbox: {
    id: "dropbox",
    label: "Dropbox",
    hosts: [{ exact: "dropbox.com" }, { suffix: ".dropbox.com" }],
    kind: {
      rule: "path-prefix",
      prefixes: [
        ["/scl/fo/", "folder"],
        ["/scl/fi/", "file"],
        ["/sh/", "folder"],
        ["/s/", "file"],
      ],
    },
    titlePrefixes: ["Dropbox - "],
    titleSuffixes: [" - Simplify your life"],
  },
  box: {
    id: "box",
    label: "Box",
    hosts: [{ exact: "box.com" }, { suffix: ".box.com" }],
    kind: {
      rule: "path-prefix",
      prefixes: [
        ["/folder/", "folder"],
        ["/file/", "file"],
      ],
    },
  },
};

/** Generic word for each kind when the provider has none of its own. */
export const KIND_LABELS: Readonly<Record<NamedKind, string>> = {
  pdf: "PDF",
  document: "Document",
  spreadsheet: "Spreadsheet",
  presentation: "Presentation",
  form: "Form",
  folder: "Folder",
  image: "Image",
  video: "Video",
  archive: "Archive",
  file: "File",
};

const OFFICE_LETTER_KINDS: ReadonlyMap<string, LinkKind> = new Map([
  ["b", "pdf"],
  ["w", "document"],
  ["x", "spreadsheet"],
  ["p", "presentation"],
  ["f", "folder"],
  ["i", "image"],
  ["v", "video"],
  ["u", "file"],
  ["t", "file"],
  ["o", "file"],
]);

const OFFICE_LETTER_PATH = /^\/(?::([a-z]):|([a-z]))\//;

const EXTENSION_GROUPS: readonly (readonly [LinkKind, readonly string[]])[] = [
  ["pdf", ["pdf"]],
  ["document", ["doc", "docx", "odt", "rtf", "txt"]],
  ["spreadsheet", ["xls", "xlsx", "xlsm", "csv", "ods"]],
  ["presentation", ["ppt", "pptx", "odp", "key"]],
  [
    "image",
    ["png", "jpg", "jpeg", "gif", "webp", "heic", "svg", "tif", "tiff", "bmp"],
  ],
  ["video", ["mp4", "mov", "m4v", "avi", "mkv", "webm"]],
  ["archive", ["zip", "7z", "rar", "tar", "gz", "tgz"]],
];

const EXTENSION_KINDS: ReadonlyMap<string, LinkKind> = new Map(
  EXTENSION_GROUPS.flatMap(([kind, extensions]) =>
    extensions.map((extension) => [extension, kind] as const)
  )
);

/** The provider whose host pattern matches `host` most specifically. */
export function providerForHost(host: string): LinkProvider | null {
  let best: LinkProvider | null = null;
  let bestScore = 0;
  for (const spec of Object.values(PROVIDERS)) {
    for (const pattern of spec.hosts) {
      const score =
        "exact" in pattern
          ? host === pattern.exact
            ? Number.POSITIVE_INFINITY
            : 0
          : host.endsWith(pattern.suffix)
          ? pattern.suffix.length
          : 0;
      if (score > bestScore) {
        best = spec.id;
        bestScore = score;
      }
    }
  }
  return best;
}

/** The kind a provider's URL path declares, if any. `path` is lowercased. */
export function kindFromPath(
  provider: LinkProvider,
  path: string
): LinkKind | null {
  const rule = PROVIDERS[provider].kind;
  switch (rule.rule) {
    case "office-letter": {
      const match = OFFICE_LETTER_PATH.exec(path);
      const letter = match?.[1] ?? match?.[2];
      return (letter && OFFICE_LETTER_KINDS.get(letter)) || null;
    }
    case "path-prefix":
      return (
        rule.prefixes.find(([prefix]) => path.startsWith(prefix))?.[1] ?? null
      );
  }
}

/** The kind a file name's extension declares, if it is a known one. */
export function kindFromFileName(name: string): LinkKind | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return EXTENSION_KINDS.get(name.slice(dot + 1).toLowerCase()) ?? null;
}
