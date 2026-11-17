import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { confluenceStorageToMarkdown, pageLinkKey } from '../src/parsers/storage-to-markdown.js';

const BASE_URL = 'https://example.atlassian.net';
const CONTEXT = { baseUrl: BASE_URL, pageId: '2066022402', spaceKey: 'PRODENG' };

function convert(storage: string, userNames: Map<string, string> = new Map()): string {
  return confluenceStorageToMarkdown(storage, { ...CONTEXT, userNames });
}

describe('Confluence storage to Markdown', () => {
  describe('when the page has a table with merged cells', () => {
    it('should produce a Markdown table that repeats merged values', () => {
      const markdown = convert(
        '<table><tbody>' +
          '<tr><th><p>Decision</p></th><th><p>Action</p></th></tr>' +
          '<tr><td rowspan="2"><p>REJECT</p></td><td><p>NONE</p></td></tr>' +
          '<tr><td><ul><li><p>SUSPEND_USER</p></li><li><p>BLOCK | USER</p></li></ul></td></tr>' +
          '</tbody></table>',
      );

      assert.equal(
        markdown,
        [
          '| Decision | Action |',
          '| --- | --- |',
          '| REJECT | NONE |',
          '| REJECT | - SUSPEND_USER<br>- BLOCK \\| USER |',
        ].join('\n'),
      );
    });
  });

  describe('when the page has a code macro', () => {
    it('should keep the code verbatim, including characters that break naive parsing', () => {
      const markdown = convert(
        '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">json</ac:parameter>' +
          '<ac:parameter ac:name="title">Respond API</ac:parameter>' +
          '<ac:plain-text-body><![CDATA[{"a": x[y[0]] > 1 && b < 2}]]></ac:plain-text-body></ac:structured-macro>' +
          '<p>after</p>',
      );

      assert.match(markdown, /\*\*Respond API\*\*\n\n```json\n\{"a": x\[y\[0\]\] > 1 && b < 2\}\n```/);
      assert.match(markdown, /after$/);
    });
  });

  describe('when an expand macro contains a panel', () => {
    it('should keep the panel inside the details block', () => {
      const markdown = convert(
        '<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">Ver.History</ac:parameter>' +
          '<ac:rich-text-body><ac:structured-macro ac:name="info"><ac:rich-text-body><p>Inner note</p>' +
          '</ac:rich-text-body></ac:structured-macro><p>Tail</p></ac:rich-text-body></ac:structured-macro>',
      );

      assert.equal(
        markdown,
        '<details>\n<summary>Ver.History</summary>\n\n> **Info**\n> \n> Inner note\n\nTail\n\n</details>',
      );
    });
  });

  describe('when the page has a self-closing table of contents macro', () => {
    it('should drop the macro without losing the content after it', () => {
      const markdown = convert('<ac:structured-macro ac:name="toc" /><h2>Requirements</h2><p>Body</p>');

      assert.equal(markdown, '## Requirements\n\nBody');
    });
  });

  describe('when the page has inline macros and links', () => {
    it('should keep status, Jira keys, mentions, page links, and dates', () => {
      const markdown = convert(
        '<p>Status <ac:structured-macro ac:name="status"><ac:parameter ac:name="title">DRAFT</ac:parameter></ac:structured-macro>' +
          ' ticket <ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">KRMFLCN-486</ac:parameter></ac:structured-macro>' +
          ' owner <ac:link><ri:user ri:account-id="abc-123" /></ac:link>' +
          ' see <ac:link><ri:page ri:content-title="Wokflow - FDS API Integration" /><ac:plain-text-link-body><![CDATA[API PRD]]></ac:plain-text-link-body></ac:link>' +
          ' on <time datetime="2026-07-16" /> done</p>',
        new Map([['abc-123', 'daniel.febrianto']]),
      );

      assert.equal(
        markdown,
        `Status [DRAFT] ticket [KRMFLCN-486](${BASE_URL}/browse/KRMFLCN-486) owner @daniel.febrianto` +
          ` see [API PRD](${BASE_URL}/wiki/display/PRODENG/Wokflow+-+FDS+API+Integration) on 2026-07-16 done`,
      );
    });

    it('should fall back to the account id when a mention name is unknown', () => {
      const markdown = convert('<p><ac:link><ri:user ri:account-id="abc-123" /></ac:link></p>');

      assert.equal(markdown, '@user:abc-123');
    });
  });

  describe('when the page has an image attachment with a caption', () => {
    it('should link the attachment download URL and keep the caption', () => {
      const markdown = convert(
        '<ac:image ac:alt="Query node"><ri:attachment ri:filename="image 1.png" /><ac:caption><p>Empty conditions</p></ac:caption></ac:image>',
      );

      assert.equal(
        markdown,
        `![Query node](${BASE_URL}/wiki/download/attachments/2066022402/image%201.png)\n_Empty conditions_`,
      );
    });
  });

  describe('when the page has a task list, placeholder, and emoticon', () => {
    it('should render checkboxes and drop editor-only text', () => {
      const markdown = convert(
        '<p><ac:placeholder>Type // to add a date</ac:placeholder></p>' +
          '<ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>Ship it <ac:emoticon ac:name="tick" /></ac:task-body></ac:task>' +
          '<ac:task><ac:task-id>2</ac:task-id><ac:task-status>incomplete</ac:task-status><ac:task-body>Review</ac:task-body></ac:task></ac:task-list>',
      );

      assert.equal(markdown, '- [x] Ship it ✅\n- [ ] Review');
    });
  });

  describe('when the page has a macro with no Markdown equivalent', () => {
    it('should leave a visible marker naming the macro', () => {
      const markdown = convert(
        '<ac:structured-macro ac:name="drawio"><ac:parameter ac:name="diagramName">Architecture</ac:parameter></ac:structured-macro>',
      );

      assert.equal(markdown, '_[Confluence macro: drawio "Architecture"]_');
    });
  });

  describe('when a template has grey hint text', () => {
    it('should drop "Type // to add" hints but keep real text', () => {
      const markdown = convert(
        '<table><tbody><tr><th><p>Target release</p></th><td><p><span style="color: rgb(151,160,175);">Type // to add a target release date</span></p></td></tr>' +
          '<tr><th><p>Epic</p></th><td><p>Type /Jira to add Jira epics and issues</p></td></tr></tbody></table><p>Type of release: minor</p>',
      );

      assert.equal(markdown, '| Target release |   |\n| --- | --- |\n| Epic |   |\n\nType of release: minor');
    });
  });

  describe('when a table is nested in a cell spanning all columns', () => {
    it('should render the nested table after the outer one and not repeat the spanning cell', () => {
      const markdown = convert(
        '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td colspan="2"><p>Matrix</p><table><tbody><tr><th>X</th></tr><tr><td>1</td></tr></tbody></table></td></tr></tbody></table>',
      );

      assert.equal(markdown, '| A | B |\n| --- | --- |\n| Matrix<br>(see table A below) |   |\n\nTable A:\n\n| X |\n| --- |\n| 1 |');
    });
  });

  describe('when the page has emoji, literal asterisks, a none-language code block, and a lowercase status', () => {
    it('should decode emoji, escape asterisks, omit the language, and upper-case the status', () => {
      const markdown = convert(
        '<h2><ac:emoticon ac:name="bar_chart" ac:emoji-id="1f4ca" ac:emoji-fallback="\\uD83D\\uDCCA" /> Metrics</h2>' +
          '<p><strong>Phase 3<sup>**</sup></strong> <ac:structured-macro ac:name="status"><ac:parameter ac:name="title">draft</ac:parameter></ac:structured-macro></p>' +
          '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">none</ac:parameter><ac:plain-text-body><![CDATA[x]]></ac:plain-text-body></ac:structured-macro>',
      );

      assert.equal(markdown, '## 📊 Metrics\n\n**Phase 3\\*\\*** [DRAFT]\n\n```\nx\n```');
    });
  });

  describe('when a page link is stored by title and its id is known', () => {
    it('should link by page id with unescaped parentheses', () => {
      const markdown = confluenceStorageToMarkdown(
        '<p><ac:link><ri:page ri:content-title="Workflow ( FDS )" /></ac:link> and <a href="https://x.com/a(b)">ext</a></p>',
        { ...CONTEXT, pageIds: new Map([[pageLinkKey('PRODENG', 'Workflow ( FDS )'), '1028915248']]) },
      );

      assert.equal(
        markdown,
        `[Workflow ( FDS )](${BASE_URL}/wiki/spaces/PRODENG/pages/1028915248) and [ext](https://x.com/a%28b%29)`,
      );
    });
  });

  describe('when text contains Markdown characters', () => {
    it('should not escape identifiers or brackets inside text', () => {
      const markdown = convert('<p>[Falcon] uses {{user_id}} and snake_case keys</p><ul><li><p>one</p></li><li><p>two</p></li></ul>');

      assert.equal(markdown, '[Falcon] uses {{user_id}} and snake_case keys\n\n- one\n- two');
    });
  });
});
