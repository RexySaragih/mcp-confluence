import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { markdownToConfluenceStorage } from '../src/parsers/markdown-to-storage.js';

const BASE_URL = 'https://example.atlassian.net';

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
      assert.match(html, /<ac:parameter ac:name="language">typescript<\/ac:parameter>/);
      assert.match(html, /const x = 1;/);
    });
  });

  describe('when the output contains void elements', () => {
    it('should self-close line breaks and rules so the XHTML is well formed', () => {
      const html = markdownToConfluenceStorage('line one\nline two\n\n---');

      assert.match(html, /<p>line one<br \/>line two<\/p>/);
      assert.match(html, /<hr \/>/);
      assert.doesNotMatch(html, /<br>|<hr>/);
    });
  });

  describe('when code contains a CDATA terminator', () => {
    it('should split the CDATA section instead of ending it early', () => {
      const html = markdownToConfluenceStorage('```js\nconst a = x[y[0]]>1;\n```');

      assert.ok(html.includes('<![CDATA[const a = x[y[0]]]]><![CDATA[>1;]]>'), html);
    });
  });

  describe('when a link URL has query parameters', () => {
    it('should escape the ampersand in the href attribute', () => {
      const html = markdownToConfluenceStorage('[Figma](https://figma.com/design/x?node-id=1&t=2)');

      assert.match(html, /<a href="https:\/\/figma\.com\/design\/x\?node-id=1&amp;t=2">Figma<\/a>/);
    });
  });

  describe('when blockquotes and table cells contain inline formatting', () => {
    it('should render the formatting and escape markup characters', () => {
      const html = markdownToConfluenceStorage('> plain **bold** quote\n\n| A | B |\n|---|---|\n| **x** | a < b |');

      assert.match(html, /<blockquote>\n<p>plain <strong>bold<\/strong> quote<\/p>\n<\/blockquote>/);
      assert.match(html, /<td><strong>x<\/strong><\/td><td>a &lt; b<\/td>/);
    });
  });

  describe('when the markdown has a details block', () => {
    it('should convert it to an expand macro with the summary as title', () => {
      const html = markdownToConfluenceStorage('<details><summary>Ver. History</summary>\n\nhidden **text**\n\n</details>\n\nafter');

      assert.match(
        html,
        /<ac:structured-macro ac:name="expand" ac:schema-version="1"><ac:parameter ac:name="title">Ver\. History<\/ac:parameter><ac:rich-text-body><p>hidden <strong>text<\/strong><\/p>/,
      );
      assert.doesNotMatch(html, /<details>|<summary>/);
      assert.match(html, /<p>after<\/p>/);
    });
  });

  describe('when the markdown has a task list', () => {
    it('should produce Confluence tasks with status', () => {
      const html = markdownToConfluenceStorage('- [ ] todo\n- [x] done');

      assert.match(html, /<ac:task-list><ac:task><ac:task-id>1<\/ac:task-id><ac:task-status>incomplete<\/ac:task-status><ac:task-body>todo<\/ac:task-body><\/ac:task>/);
      assert.match(html, /<ac:task-status>complete<\/ac:task-status><ac:task-body>done<\/ac:task-body>/);
      assert.doesNotMatch(html, /<input/);
    });
  });

  describe('when a blockquote is a panel', () => {
    it('should convert GitHub alerts to panel macros', () => {
      const html = markdownToConfluenceStorage('> [!WARNING]\n> Rotate the keys first.');

      assert.match(html, /<ac:structured-macro ac:name="note" ac:schema-version="1"><ac:rich-text-body><p>Rotate the keys first.<\/p>/);
    });

    it('should convert a labelled blockquote produced by the page reader back to a panel', () => {
      const html = markdownToConfluenceStorage('> **Info: Heads up**\n>\n> Timeout is 1000 ms');

      assert.match(
        html,
        /<ac:structured-macro ac:name="info" ac:schema-version="1"><ac:parameter ac:name="title">Heads up<\/ac:parameter><ac:rich-text-body><p>Timeout is 1000 ms<\/p>/,
      );
    });
  });

  describe('when the markdown has images', () => {
    it('should reference attachments of the page being written', () => {
      const html = markdownToConfluenceStorage(
        `![Diagram](${BASE_URL}/wiki/download/attachments/123/Risk%20Page%20(21).png?version=1)`,
        { baseUrl: BASE_URL, pageId: '123' },
      );

      assert.match(html, /<ac:image ac:alt="Diagram"><ri:attachment ri:filename="Risk Page \(21\)\.png" \/><\/ac:image>/);
    });

    it('should use a URL reference for external images and text for local files', () => {
      const html = markdownToConfluenceStorage('![Logo](https://cdn.example.com/logo.png) ![Local](./diagram.png)');

      assert.match(html, /<ac:image ac:alt="Logo"><ri:url ri:value="https:\/\/cdn\.example\.com\/logo\.png" \/><\/ac:image>/);
      assert.match(html, /\[Image not uploaded: Local\]/);
    });
  });

  describe('when the markdown contains raw HTML', () => {
    it('should self-close allowed void tags and escape unknown tags', () => {
      const html = markdownToConfluenceStorage('Use <name> here<br>and <u>this</u>.');

      assert.match(html, /Use &lt;name&gt; here<br \/>and <u>this<\/u>\./);
    });
  });

  describe('when called repeatedly', () => {
    it('should give the same output each time', () => {
      const markdown = '- [ ] a\n\n```js\nx\n```';

      assert.equal(markdownToConfluenceStorage(markdown), markdownToConfluenceStorage(markdown));
    });
  });
});
