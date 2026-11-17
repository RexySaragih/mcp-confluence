import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adfToMarkdown } from '../src/parsers/adf-to-markdown.js';
import { markdownToAdf } from '../src/parsers/markdown-to-adf.js';

const text = (value: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });

describe('ADF to Markdown', () => {
  describe('when a paragraph mixes plain and formatted text', () => {
    it('should keep it on one line with the formatting applied', () => {
      const markdown = adfToMarkdown({
        type: 'doc',
        content: [paragraph(text('Hello '), text('world', [{ type: 'strong' }]), text('!'))],
      });

      assert.equal(markdown, 'Hello **world**!');
    });
  });

  describe('when the document has nested lists', () => {
    it('should indent the nested items under their parent', () => {
      const markdown = adfToMarkdown({
        type: 'doc',
        content: [
          {
            type: 'orderedList',
            content: [
              {
                type: 'listItem',
                content: [
                  paragraph(text('Parent')),
                  { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('Child'))] }] },
                ],
              },
            ],
          },
        ],
      });

      assert.equal(markdown, '1. Parent\n   - Child');
    });
  });

  describe('when the document has inline nodes', () => {
    it('should render mentions, links, cards, status, and dates', () => {
      const markdown = adfToMarkdown({
        type: 'doc',
        content: [
          paragraph(
            { type: 'mention', attrs: { text: '@Alice' } },
            text(' see '),
            text('docs', [{ type: 'link', attrs: { href: 'https://example.com/docs' } }]),
            text(' '),
            { type: 'inlineCard', attrs: { url: 'https://example.atlassian.net/browse/ENG-1' } },
            text(' '),
            { type: 'status', attrs: { text: 'IN REVIEW' } },
            text(' '),
            { type: 'date', attrs: { timestamp: '1784160000000' } },
          ),
        ],
      });

      assert.equal(
        markdown,
        '@Alice see [docs](https://example.com/docs) https://example.atlassian.net/browse/ENG-1 [IN REVIEW] 2026-07-16',
      );
    });
  });

  describe('when the document has a table and a panel', () => {
    it('should render a Markdown table and a labelled blockquote', () => {
      const markdown = adfToMarkdown({
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              { type: 'tableRow', content: [{ type: 'tableHeader', content: [paragraph(text('Key'))] }, { type: 'tableHeader', content: [paragraph(text('Value'))] }] },
              { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(text('a'))] }, { type: 'tableCell', content: [paragraph(text('b'))] }] },
            ],
          },
          { type: 'panel', attrs: { panelType: 'warning' }, content: [paragraph(text('Careful'))] },
        ],
      });

      assert.equal(markdown, '| Key | Value |\n| --- | --- |\n| a | b |\n\n> **Warning**\n>\n> Careful');
    });
  });
});

describe('Markdown to ADF', () => {
  describe('when converting formatted text and lists', () => {
    it('should produce ADF paragraphs, marks, and lists', () => {
      const doc = markdownToAdf('Please check **retry** and [docs](https://example.com).\n\n- one\n- two');

      assert.deepEqual(doc.content[0], {
        type: 'paragraph',
        content: [
          text('Please check '),
          text('retry', [{ type: 'strong' }]),
          text(' and '),
          text('docs', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
          text('.'),
        ],
      });
      assert.deepEqual(doc.content[1], {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph(text('one'))] },
          { type: 'listItem', content: [paragraph(text('two'))] },
        ],
      });
    });
  });

  describe('when converting code', () => {
    it('should produce a code block and code marks without decoding issues', () => {
      const doc = markdownToAdf('Run `a < b`\n\n```sql\nSELECT 1;\n```');

      assert.deepEqual(doc.content[0], paragraph(text('Run '), text('a < b', [{ type: 'code' }])));
      assert.deepEqual(doc.content[1], { type: 'codeBlock', attrs: { language: 'sql' }, content: [text('SELECT 1;')] });
    });
  });

  describe('when the markdown is plain text with line breaks', () => {
    it('should keep the breaks as hard breaks', () => {
      const doc = markdownToAdf('line one\nline two');

      assert.deepEqual(doc.content[0], paragraph(text('line one'), { type: 'hardBreak' }, text('line two')));
    });
  });
});
