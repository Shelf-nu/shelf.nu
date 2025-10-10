import Markdoc from "@markdoc/markdoc";
import MarkdownIt from "markdown-it";
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownParser,
  MarkdownSerializer,
} from "prosemirror-markdown";
import { Fragment, Schema, type Node as ProseMirrorNode, type NodeSpec } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";

const RAW_BLOCK_PLACEHOLDER_PREFIX = "⟦raw:";
const RAW_BLOCK_PLACEHOLDER_REGEX = /⟦raw:(\d+)⟧/;

const SUPPORTED_MARKDOC_TYPES = new Set([
  "document",
  "paragraph",
  "inline",
  "text",
  "strong",
  "em",
  "link",
  "code",
  "list",
  "item",
  "heading",
  "blockquote",
  "hr",
  "fence",
]);

interface RawBlock {
  id: number;
  content: string;
}

const rawBlockSpec: NodeSpec = {
  group: "block",
  atom: true,
  selectable: true,
  attrs: {
    raw: { default: "" },
  },
  parseDOM: [
    {
      tag: "div[data-raw-block]",
      getAttrs: (dom) => ({
        raw: (dom as HTMLElement).getAttribute("data-raw-content") ?? "",
      }),
    },
  ],
  toDOM: (node) => [
    "div",
    {
      "data-raw-block": "true",
      "data-raw-content": node.attrs.raw,
      class: "pm-raw-block",
    },
    ["pre", { "aria-label": "Unsupported Markdoc block" }, node.attrs.raw],
  ],
};

let cachedSchema: Schema | null = null;
const serializerCache = new WeakMap<Schema, MarkdownSerializer>();

function buildSchema(): Schema {
  const headingSpec = {
    ...basicSchema.spec.nodes.get("heading")!,
    attrs: { level: { default: 1 } },
    parseDOM: [
      { tag: "h1", attrs: { level: 1 } },
      { tag: "h2", attrs: { level: 2 } },
      { tag: "h3", attrs: { level: 3 } },
      { tag: "h4", attrs: { level: 4 } },
    ],
    toDOM(node: ProseMirrorNode) {
      const level = Math.min(Math.max(node.attrs.level, 1), 4);
      return ["h" + level, 0];
    },
  } satisfies NodeSpec;

  let nodes = basicSchema.spec.nodes;
  nodes = nodes.update("heading", headingSpec);
  nodes = addListNodes(nodes, "paragraph block*", "block");
  nodes = nodes.append({ raw_block: rawBlockSpec });

  return new Schema({ nodes, marks: basicSchema.spec.marks });
}

function getSerializer(schema: Schema): MarkdownSerializer {
  let serializer = serializerCache.get(schema);
  if (serializer) {
    return serializer;
  }

  serializer = new MarkdownSerializer(
    {
      ...defaultMarkdownSerializer.nodes,
      bullet_list(state, node) {
        state.renderList(node, "", () => "- ");
      },
      raw_block(state, node) {
        state.ensureNewLine();
        state.write(node.attrs.raw ?? "");
        state.closeBlock(node);
      },
    },
    defaultMarkdownSerializer.marks,
  );

  serializerCache.set(schema, serializer);
  return serializer;
}

function createMarkdownParser(schema: Schema, _rawBlocks: RawBlock[]): MarkdownParser {
  const tokenizer = new MarkdownIt("commonmark", { html: false, breaks: false });
  const tokens = {
    ...defaultMarkdownParser.tokens,
  } satisfies MarkdownParser["tokens"];

  return new MarkdownParser(schema, tokenizer as any, tokens as any);
}

interface RawSegment {
  start: number;
  end: number;
  content: string;
}

function computeLineOffsets(markdoc: string): number[] {
  const offsets: number[] = [0];
  for (let index = 0; index < markdoc.length; index += 1) {
    if (markdoc[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  offsets.push(markdoc.length);
  return offsets;
}

function toSegments(markdoc: string): RawSegment[] {
  const ast = Markdoc.parse(markdoc);
  const offsets = computeLineOffsets(markdoc);
  const segments: RawSegment[] = [];

  function visit(node: any) {
    if (!node) {
      return;
    }

    if (!SUPPORTED_MARKDOC_TYPES.has(node.type) && node.inline === false) {
      const lines: number[] = Array.isArray(node.lines) ? node.lines : [];
      if (lines.length > 0) {
        const startLine = Math.min(...lines);
        const endLine = Math.max(...lines);
        const start = offsets[Math.max(startLine, 0)] ?? 0;
        const end = offsets[Math.max(endLine, 0)] ?? markdoc.length;
        const content = markdoc.slice(start, end);
        segments.push({ start, end, content });
        return;
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  visit(ast);
  segments.sort((a, b) => a.start - b.start);

  const deduped: RawSegment[] = [];
  let lastEnd = -1;
  for (const segment of segments) {
    if (segment.start >= lastEnd) {
      deduped.push(segment);
      lastEnd = segment.end;
    }
  }

  return deduped;
}

function normalizeRawBlocks(markdoc: string): { text: string; rawBlocks: RawBlock[] } {
  const segments = toSegments(markdoc);
  if (segments.length === 0) {
    return { text: markdoc, rawBlocks: [] };
  }

  const rawBlocks: RawBlock[] = [];
  let cursor = 0;
  let normalized = "";

  segments.forEach((segment) => {
    if (segment.start < cursor) {
      return;
    }

    const id = rawBlocks.length;
    rawBlocks.push({ id, content: segment.content });
    normalized += markdoc.slice(cursor, segment.start);
    if (normalized.length > 0 && !normalized.endsWith("\n")) {
      normalized += "\n";
    }
    const trailingMatch = segment.content.match(/\n*$/);
    const trailingNewlines = trailingMatch ? trailingMatch[0].length : 0;
    const requiredTrailing = trailingNewlines >= 2 ? trailingNewlines : 2;
    const placeholder = `${RAW_BLOCK_PLACEHOLDER_PREFIX}${id}⟧`;
    normalized += `${placeholder}${"\n".repeat(requiredTrailing)}`;
    cursor = segment.end;
  });

  normalized += markdoc.slice(cursor);

  return { text: normalized, rawBlocks };
}

function replaceRawPlaceholders(
  node: ProseMirrorNode,
  schema: Schema,
  rawBlocks: RawBlock[],
): ProseMirrorNode {
  let changed = false;
  const children: ProseMirrorNode[] = [];

  node.forEach((child) => {
    let nextNode = child;

    if (child.type.name === "paragraph" && child.childCount === 1) {
      const first = child.child(0);
      const text = first.isText ? first.text?.trim() : undefined;
      const match = text ? text.match(RAW_BLOCK_PLACEHOLDER_REGEX) : null;
      if (match) {
        const index = Number.parseInt(match[1], 10);
        const raw = rawBlocks[index]?.content ?? "";
        nextNode = schema.nodes.raw_block.create({ raw });
        changed = true;
        children.push(nextNode);
        return;
      }
    }

    const replacedChild = replaceRawPlaceholders(child, schema, rawBlocks);
    if (replacedChild !== child) {
      nextNode = replacedChild;
      changed = true;
    }
    children.push(nextNode);
  });

  if (!changed) {
    return node;
  }

  return node.copy(Fragment.from(children));
}

export function createEditorSchema(): Schema {
  if (!cachedSchema) {
    cachedSchema = buildSchema();
  }
  return cachedSchema;
}

export function parseMarkdoc(markdoc: string, schema: Schema): ProseMirrorNode {
  const { text, rawBlocks } = normalizeRawBlocks(markdoc);
  const parser = createMarkdownParser(schema, rawBlocks);
  const doc = parser.parse(text);
  return replaceRawPlaceholders(doc, schema, rawBlocks);
}

export function serializeMarkdoc(doc: ProseMirrorNode, schema: Schema): string {
  const serializer = getSerializer(schema);
  const output = serializer.serialize(doc, { tightLists: true });
  return output.endsWith("\n") ? output : `${output}\n`;
}

export function countRawBlocks(doc: ProseMirrorNode): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === "raw_block") {
      count += 1;
    }
  });
  return count;
}
