import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { markdownToConfluenceStorage } from '../src/parsers/markdown-to-storage.js';

describe('Markdown to Confluence Storage', () => {
  describe('when converting common markdown', () => {
    it('should produce storage-format HTML for headings and paragraphs', () => {
      const html = markdownToConfluenceStorage('# Title\n\nSome paragraph text.');

      assert.match(html, /<h1>Title<\/h1>/);
      assert.match(html, /<p>Some paragraph text.<\/p>/);
    });

    it('should wrap fenced code blocks in Confluence code macros', () => {
      const html = markdownToConfluenceStorage('```typescript\nconst x = 1;\n```');

      assert.match(html, /ac:structured-macro/);
      assert.match(html, /ac:name="code"/);
      assert.match(html, /typescript/);
      assert.match(html, /const x = 1;/);
    });
  });
});
