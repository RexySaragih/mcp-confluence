import { marked, type Tokens } from 'marked';

/**
 * Converts Markdown content to Confluence Storage Format (XHTML).
 * 
 * Confluence Storage Format is an XHTML-based format that Confluence uses
 * internally to store page content. This converter handles:
 * - Standard Markdown elements (headings, lists, code blocks, etc.)
 * - Mermaid diagram placeholders (replaced with ac:image macros)
 * - Code blocks with Confluence code macro
 */

interface MermaidPlaceholder {
  id: string;
  svgContent: string;
}

/**
 * Converts Markdown to Confluence Storage Format XHTML.
 * @param markdown - The markdown content to convert
 * @param mermaidAttachmentUrls - Optional map of mermaid diagram IDs to their attachment URLs
 * @returns Confluence Storage Format XHTML
 */
export function markdownToConfluenceStorage(
  markdown: string,
  mermaidAttachmentUrls?: Map<string, string>,
): string {
  // Pre-process: Extract and replace mermaid code blocks with placeholders
  const { processedMarkdown, mermaidBlocks } = extractMermaidBlocks(markdown);

  // Configure marked for XHTML output
  const renderer = new marked.Renderer();

  // Custom heading renderer for Confluence
  renderer.heading = (token: Tokens.Heading) => {
    const text = token.tokens.map((t: Tokens.Text | Tokens.Generic) => ('text' in t ? t.text : '')).join('');
    return `<h${token.depth}>${escapeXml(text)}</h${token.depth}>\n`;
  };

  // Custom code block renderer for Confluence code macro
  renderer.code = (token: Tokens.Code) => {
    const language = token.lang || 'none';
    return `<ac:structured-macro ac:name="code" ac:schema-version="1">
<ac:parameter ac:name="language">${escapeXml(language)}</ac:parameter>
<ac:plain-text-body><![CDATA[${token.text}]]></ac:plain-text-body>
</ac:structured-macro>\n`;
  };

  // Custom inline code
  renderer.codespan = (token: Tokens.Codespan) => {
    return `<code>${escapeXml(token.text)}</code>`;
  };

  // Custom link renderer
  renderer.link = (token: Tokens.Link) => {
    const titleAttr = token.title ? ` title="${escapeXml(token.title)}"` : '';
    return `<a href="${escapeXml(token.href)}"${titleAttr}>${token.text}</a>`;
  };

  // Custom image renderer
  renderer.image = (token: Tokens.Image) => {
    const altAttr = token.text ? ` ac:alt="${escapeXml(token.text)}"` : '';
    const titleAttr = token.title ? ` ac:title="${escapeXml(token.title)}"` : '';
    return `<ac:image${altAttr}${titleAttr}><ri:url ri:value="${escapeXml(token.href)}" /></ac:image>`;
  };

  // Custom blockquote for Confluence info panel
  renderer.blockquote = (token: Tokens.Blockquote) => {
    const text = token.tokens.map((t: Tokens.Text | Tokens.Generic) => ('text' in t ? t.text : '')).join('');
    return `<ac:structured-macro ac:name="info" ac:schema-version="1">
<ac:rich-text-body><p>${text}</p></ac:rich-text-body>
</ac:structured-macro>\n`;
  };

  // Custom table renderer
  renderer.table = (token: Tokens.Table) => {
    let html = '<table><thead><tr>';
    for (const cell of token.header) {
      html += `<th>${cell.text}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (const row of token.rows) {
      html += '<tr>';
      for (const cell of row) {
        html += `<td>${cell.text}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>\n';
    return html;
  };

  // Custom horizontal rule
  renderer.hr = () => '<hr />\n';

  // Set up marked with the custom renderer
  marked.use({ renderer });

  // Convert to HTML
  let html = marked.parse(processedMarkdown) as string;

  // Post-process: Replace mermaid placeholders with code blocks and images
  for (const block of mermaidBlocks) {
    const placeholder = `[MERMAID_DIAGRAM_${block.id}]`;
    const attachmentUrl = mermaidAttachmentUrls?.get(block.id);
    
    let replacement = '';
    
    // Display the Mermaid code in a code block
    replacement += `<ac:structured-macro ac:name="code" ac:schema-version="1">
<ac:parameter ac:name="language">mermaid</ac:parameter>
<ac:plain-text-body><![CDATA[${block.code}]]></ac:plain-text-body>
</ac:structured-macro>`;
    
    // If we have an attachment URL, embed the image below the code
    if (attachmentUrl) {
      // Add default width (800px) and center alignment
      replacement += `<p><ac:image ac:align="center" ac:width="800"><ri:attachment ri:filename="mermaid-diagram-${block.id}.svg" /></ac:image></p>`;
    }
    
    // Replace all occurrences using regex with global flag
    // Escape special regex characters in the placeholder
    const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match the placeholder in various HTML contexts (inside <p>, standalone, etc.)
    const regex = new RegExp(`<p>${escapedPlaceholder}</p>|${escapedPlaceholder}`, 'g');
    html = html.replace(regex, replacement);
  }

  return html;
}

interface ExtractedMermaid {
  processedMarkdown: string;
  mermaidBlocks: { id: string; code: string }[];
}

/**
 * Extracts mermaid code blocks and replaces them with placeholders.
 */
function extractMermaidBlocks(markdown: string): ExtractedMermaid {
  const mermaidBlocks: { id: string; code: string }[] = [];
  let counter = 0;

  const processedMarkdown = markdown.replace(
    /```mermaid\n([\s\S]*?)```/g,
    (_, code: string) => {
      const id = `mermaid_${counter++}`;
      mermaidBlocks.push({ id, code: code.trim() });
      return `[MERMAID_DIAGRAM_${id}]`;
    },
  );

  return { processedMarkdown, mermaidBlocks };
}

/**
 * Escapes special XML characters.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Extracts mermaid code blocks from markdown content.
 * Returns an array of { id, code } objects.
 */
export function extractMermaidFromMarkdown(markdown: string): { id: string; code: string }[] {
  const { mermaidBlocks } = extractMermaidBlocks(markdown);
  return mermaidBlocks;
}

