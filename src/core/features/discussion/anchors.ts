import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { decodeString } from 'micromark-util-decode-string';
import { z } from 'zod';

type TextNode = { type: string; value?: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: TextNode[]; data?: unknown };
type RenderedNode = TextNode & { properties?: Record<string, unknown> };
export const descriptionAnchorSchema = z.object({
  quote: z.string().min(1).max(100000),
  start: z.number().int().nonnegative().max(100000),
  end: z.number().int().positive().max(100000),
  expectedDescription: z.string().max(100000),
}).strict();
export type DescriptionAnchorInput = z.infer<typeof descriptionAnchorSchema>;
export const documentAnchorSchema = descriptionAnchorSchema.omit({ expectedDescription: true }).extend({
  documentId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  expectedVersion: z.number().int().positive(),
  expectedBody: z.string().max(100000),
}).strict();
export const threadAnchorSchema = z.union([descriptionAnchorSchema, documentAnchorSchema]);
export type ThreadAnchorInput = z.infer<typeof threadAnchorSchema>;
export type DescriptionAnchor = { quote: string; start: number; end: number; removed: boolean; documentId?: string };

/** Source positions count Unicode code points, as SQLite substr does. */
export function codePointOffset(source: string, offset: number) {
  return Array.from(source.slice(0, offset)).length;
}

/** Map decoded Markdown text boundaries back to its source, including escapes
 * and entities. Unsupported generated text has no selectable source boundary. */
export function textBoundaries(source: string, start: number, end: number, text: string, literal = false) {
  if (literal) return source.slice(start, end) === text ? Array.from({length:text.length+1}, (_, i) => start+i) : null;
  const raw = source.slice(start, end), boundaries = [start];
  let decoded = '';
  for (let i = 0; i < raw.length;) {
    const token = raw.slice(i).match(/^(?:\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|&(?:#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);)/)?.[0] ?? raw[i]!;
    const value = decodeString(token);
    decoded += value;
    for (let j = 0; j < value.length; j++) boundaries.push(start + i + (j === value.length - 1 ? token.length : 0));
    i += token.length;
  }
  return decoded === text ? boundaries : null;
}

function visitText(node: TextNode, visit: (node: TextNode) => void) {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') visit(node);
  else node.children?.forEach(child => visitText(child, visit));
}

export function quoteAt(source: string, start: number, end: number) {
  let quote = '';
  const points = Array.from(source), utfStart = points.slice(0, start).join('').length, utfEnd = points.slice(0, end).join('').length;
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  visitText(tree, node => {
    const a = node.position?.start.offset, b = node.position?.end.offset;
    if (a === undefined || b === undefined) return;
    const text = node.value ?? '';
    const literal = node.type !== 'text', contentStart = literal ? source.indexOf(text, a) : a;
    if (contentStart < a || (literal && contentStart + text.length > b)) return;
    const boundaries = textBoundaries(source, contentStart, literal ? contentStart+text.length : b, text, literal);
    if (!boundaries) return;
    for (let i = 0; i < text.length; i++) {
      if (boundaries[i]! >= utfStart && boundaries[i + 1]! <= utfEnd) quote += text[i];
    }
  });
  return quote;
}

export function validDescriptionAnchor(input: DescriptionAnchorInput): DescriptionAnchor | null {
  if (input.start >= input.end || input.end > Array.from(input.expectedDescription).length ||
      !input.quote.trim() || quoteAt(input.expectedDescription, input.start, input.end) !== input.quote) return null;
  return { quote: input.quote, start: input.start, end: input.end, removed: false };
}

/** Annotate rendered text with its actual Markdown source, without raw HTML. */
export function remarkDescriptionAnchors({ enabled = false } = {}) {
  return (tree: TextNode, file: { value: unknown }) => {
    if (!enabled) return;
    const source = String(file.value);
    function visit(node: TextNode) {
      if (!node.children) return;
      node.children = node.children.map(child => {
        if (child.type === 'text' && child.position?.start.offset !== undefined && child.position.end.offset !== undefined) {
          const data = child.data as { hChildren?: RenderedNode[] } | undefined;
          if (data?.hChildren) {
            // Rendered replacements carry their own source runs. A renamed
            // chip is atomic; the surrounding prose still maps characterwise.
            data.hChildren = data.hChildren.map(part => {
              const start = part.position?.start.offset, end = part.position?.end.offset;
              if (start === undefined || end === undefined) return part;
              const properties = { 'data-description-start': start, 'data-description-end': end };
              return part.type === 'text'
                ? { type: 'element', tagName: 'span', properties, children: [part] }
                : { ...part, properties: { ...part.properties, ...properties, 'data-description-atomic': true } };
            });
            return child;
          }
          return { type: 'descriptionText', data: { hName: 'span', hProperties: {
            'data-description-start': child.position.start.offset,
            'data-description-end': child.position.end.offset,
          } }, children: [child] };
        }
        if ((child.type === 'inlineCode' || child.type === 'code') && child.value) {
          const a = child.position?.start.offset, b = child.position?.end.offset;
          const start = a === undefined ? -1 : source.indexOf(child.value, a);
          if (a !== undefined && b !== undefined && start >= a && start + child.value.length <= b)
            child.data = { hProperties: { 'data-description-start': start, 'data-description-end': start+child.value.length, 'data-description-literal': child.value.length } };
        }
        visit(child);
        return child;
      });
    }
    visit(tree);
  };
}
