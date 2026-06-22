import { marked, type Tokens } from 'marked';

/**
 * Converts Markdown to Confluence Storage Format (XHTML).
 * Slim version — no Mermaid rendering or attachment pipeline.
 */
export function markdownToConfluenceStorage(markdown: string): string {
  const renderer = new marked.Renderer();

  renderer.code = ({ text, lang }: Tokens.Code) => {
    const language = lang || 'none';
    return `<ac:structured-macro ac:name="code" ac:schema-version="1">
<ac:parameter ac:name="language">${escapeHtml(language)}</ac:parameter>
<ac:plain-text-body><![CDATA[${text}]]></ac:plain-text-body>
</ac:structured-macro>`;
  };

  renderer.blockquote = ({ text }: Tokens.Blockquote) => `<blockquote>${text}</blockquote>`;
  renderer.table = (token: Tokens.Table) => {
    const header = token.header
      .map((cell) => `<th>${cell.text}</th>`)
      .join('');
    const rows = token.rows
      .map((row) => `<tr>${row.map((cell) => `<td>${cell.text}</td>`).join('')}</tr>`)
      .join('');
    return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
  };

  marked.use({ renderer, gfm: true, breaks: true });
  return marked.parse(markdown) as string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
