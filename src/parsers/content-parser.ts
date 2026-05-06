import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

// Turndown rule: convert <pre data-language="..."> into fenced code blocks
turndown.addRule('confluenceCodeBlock', {
  filter: (node) =>
    node.nodeName === 'PRE' && node.hasAttribute('data-language'),
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const lang = el.getAttribute('data-language') || '';
    const code = el.textContent || '';
    return `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
  },
});

// Turndown rule: convert <details>/<summary> (expand macro) into markdown
turndown.addRule('confluenceExpand', {
  filter: 'details',
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const summary = el.querySelector('summary');
    const title = summary?.textContent?.trim() || 'Details';
    // Remove the summary text from the content since we handle it separately
    const body = content.replace(/^\s*.*?\n/, '').trim();
    return `\n<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>\n`;
  },
});

// Turndown rule: convert <figure>/<figcaption> into image with caption
turndown.addRule('figureWithCaption', {
  filter: 'figure',
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const img = el.querySelector('img');
    const figcaption = el.querySelector('figcaption');
    const caption = figcaption?.textContent?.trim() || '';
    const src = img?.getAttribute('src') || '';
    const alt = img?.getAttribute('alt') || caption || '';

    let result = `![${alt}](${src})`;
    if (caption) {
      result += `\n*${caption}*`;
    }
    return `\n${result}\n`;
  },
});

type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
  marks?: { type?: string; attrs?: Record<string, any> }[];
  attrs?: Record<string, any>;
};

export function adfToMarkdown(adf: unknown): string {
  if (!adf || typeof adf !== 'object') return '';
  const node = adf as AdfNode;

  if (Array.isArray((node as any).content)) {
    return (node as any).content.map(convertNode).join('\n').trim();
  }

  return convertNode(node).trim();
}

export interface ConfluenceContext {
  baseUrl?: string;
  pageId?: string;
}

export function confluenceStorageToMarkdown(html?: string, context?: ConfluenceContext): string {
  if (!html) return '';
  const preprocessed = preprocessConfluenceMacros(html, context);
  return turndown.turndown(preprocessed).trim();
}

/**
 * Pre-processes Confluence storage format XML to convert custom ac:structured-macro
 * elements into standard HTML that Turndown can handle.
 *
 * Handles:
 * - Code macro → <pre data-language="...">
 * - Expand macro → <details><summary>
 * - Info/Note/Warning/Tip panels → <blockquote>
 * - Panel macro → <blockquote>
 * - TOC macro → removed (not useful in markdown)
 * - Nested ac:rich-text-body / ac:plain-text-body → unwrapped
 */
function preprocessConfluenceMacros(html: string, context?: ConfluenceContext): string {
  let result = html;

  // 1. Code macro: extract language and CDATA body into <pre>
  //    Handles both ac:structured-macro and ac:macro variants
  result = result.replace(
    /<ac:(?:structured-)?macro[^>]*ac:name="code"[^>]*>[\s\S]*?<\/ac:(?:structured-)?macro>/gi,
    (match) => {
      const langMatch = match.match(
        /<ac:parameter[^>]*ac:name="language"[^>]*>(.*?)<\/ac:parameter>/i,
      );
      const titleMatch = match.match(
        /<ac:parameter[^>]*ac:name="title"[^>]*>(.*?)<\/ac:parameter>/i,
      );
      const language = langMatch?.[1]?.trim() || '';

      // Extract code from CDATA or plain text body
      let code = '';
      const cdataMatch = match.match(
        /<ac:plain-text-body>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/ac:plain-text-body>/i,
      );
      if (cdataMatch) {
        code = cdataMatch[1];
      } else {
        const plainMatch = match.match(
          /<ac:plain-text-body>([\s\S]*?)<\/ac:plain-text-body>/i,
        );
        code = plainMatch?.[1] || '';
      }

      const titleComment = titleMatch?.[1] ? `<!-- title: ${titleMatch[1]} -->\n` : '';
      return `${titleComment}<pre data-language="${language}">${escapeHtml(code)}</pre>`;
    },
  );

  // 2. Expand macro → <details><summary>
  result = result.replace(
    /<ac:(?:structured-)?macro[^>]*ac:name="expand"[^>]*>([\s\S]*?)<\/ac:(?:structured-)?macro>/gi,
    (match, inner: string) => {
      const titleMatch = inner.match(
        /<ac:parameter[^>]*ac:name="title"[^>]*>(.*?)<\/ac:parameter>/i,
      );
      const title = titleMatch?.[1]?.trim() || 'Click to expand';

      // Extract the rich-text-body content
      const bodyMatch = inner.match(
        /<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/i,
      );
      const body = bodyMatch?.[1] || '';

      return `<details><summary>${title}</summary>${body}</details>`;
    },
  );

  // 3. Info/Note/Warning/Tip macros → <blockquote> with label
  result = result.replace(
    /<ac:(?:structured-)?macro[^>]*ac:name="(info|note|warning|tip)"[^>]*>([\s\S]*?)<\/ac:(?:structured-)?macro>/gi,
    (_match, macroName: string, inner: string) => {
      const bodyMatch = inner.match(
        /<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/i,
      );
      const body = bodyMatch?.[1] || '';
      const label = macroName.charAt(0).toUpperCase() + macroName.slice(1);
      return `<blockquote><strong>${label}:</strong> ${body}</blockquote>`;
    },
  );

  // 4. Panel macro → <blockquote>
  result = result.replace(
    /<ac:(?:structured-)?macro[^>]*ac:name="panel"[^>]*>([\s\S]*?)<\/ac:(?:structured-)?macro>/gi,
    (_match, inner: string) => {
      const titleMatch = inner.match(
        /<ac:parameter[^>]*ac:name="title"[^>]*>(.*?)<\/ac:parameter>/i,
      );
      const bodyMatch = inner.match(
        /<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/i,
      );
      const body = bodyMatch?.[1] || '';
      const titleHtml = titleMatch?.[1] ? `<strong>${titleMatch[1]}</strong><br/>` : '';
      return `<blockquote>${titleHtml}${body}</blockquote>`;
    },
  );

  // 5. TOC macro → remove entirely (not useful in markdown output)
  result = result.replace(
    /<ac:(?:structured-)?macro[^>]*ac:name="toc"[^>]*>[\s\S]*?<\/ac:(?:structured-)?macro>/gi,
    '',
  );
  // Self-closing TOC
  result = result.replace(
    /<ac:(?:structured-)?macro[^>]*ac:name="toc"[^>]*\/>/gi,
    '',
  );

  // 6. Clean up remaining ac:parameter tags (from any unhandled macros)
  result = result.replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/gi, '');

  // 7. Unwrap ac:rich-text-body and ac:plain-text-body (from any remaining macros)
  result = result.replace(/<\/?ac:rich-text-body>/gi, '');
  result = result.replace(
    /<ac:plain-text-body>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/ac:plain-text-body>/gi,
    (_match, content: string) => `<pre>${escapeHtml(content)}</pre>`,
  );
  result = result.replace(/<\/?ac:plain-text-body>/gi, '');

  // 8. Strip remaining ac:structured-macro wrappers (pass through their content)
  result = result.replace(/<\/?ac:(?:structured-)?macro[^>]*>/gi, '');

  // 9. Handle ac:image with ri:attachment (embedded attachments)
  //    Also handles ac:caption element (Confluence Cloud image captions)
  result = result.replace(
    /<ac:image([^>]*)>([\s\S]*?)<\/ac:image>/gi,
    (_match, attrs: string, inner: string) => {
      // Extract filename from ri:attachment
      const filenameMatch = inner.match(/ri:filename="([^"]*)"/i);
      const filename = filenameMatch?.[1] || '';

      // Extract external URL from ri:url
      const urlMatch = inner.match(/ri:value="([^"]*)"/i);
      const externalUrl = urlMatch?.[1] || '';

      // Extract caption from ac:caption element (strip inner HTML tags)
      const captionMatch = inner.match(/<ac:caption[^>]*>([\s\S]*?)<\/ac:caption>/i);
      const caption = captionMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || '';

      // Extract alt text from ac:alt attribute
      const altMatch = attrs.match(/ac:alt="([^"]*)"/i);
      const alt = altMatch?.[1] || caption || filename;

      // Extract title from ac:title attribute
      const titleMatch = attrs.match(/ac:title="([^"]*)"/i);
      const title = titleMatch?.[1] || '';

      let src: string;
      if (externalUrl) {
        src = externalUrl;
      } else if (filename && context?.baseUrl && context?.pageId) {
        src = `${context.baseUrl}/wiki/download/attachments/${context.pageId}/${encodeURIComponent(filename)}`;
      } else {
        src = filename || externalUrl;
      }

      let imgHtml = `<img src="${src}" alt="${alt}" />`;

      // Add caption as a figcaption-style element below the image
      const captionText = caption || title;
      if (captionText) {
        imgHtml = `<figure>${imgHtml}<figcaption>${captionText}</figcaption></figure>`;
      }

      return imgHtml;
    },
  );

  // 10. Handle ac:link with ri:page (internal Confluence links)
  result = result.replace(
    /<ac:link>[\s\S]*?<ri:page\s+ri:content-title="([^"]*)"[^>]*\/>[\s\S]*?(?:<ac:plain-text-link-body>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/ac:plain-text-link-body>[\s\S]*?)?<\/ac:link>/gi,
    (_match, pageTitle: string, linkText?: string) => {
      const text = linkText?.trim() || pageTitle;
      return `<a href="#">${text}</a>`;
    },
  );

  // 11. Strip any remaining ac: / ri: namespaced tags
  result = result.replace(/<\/?(?:ac|ri):[^>]*>/gi, '');

  return result;
}

/**
 * Escapes HTML special characters in code content so it survives
 * being placed inside an HTML <pre> tag for Turndown to process.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function convertNode(node?: AdfNode, listState?: { type: 'bullet' | 'ordered'; index: number }): string {
  if (!node) return '';
  const { type, content = [], text, marks, attrs } = node;

  switch (type) {
    case 'text':
      return applyMarks(text ?? '', marks);
    case 'paragraph': {
      const inner = content.map((child) => convertNode(child)).join('');
      return inner.trim() ? `${inner}\n` : '';
    }
    case 'heading': {
      const level = Math.min(Math.max(attrs?.level ?? 1, 1), 6);
      const inner = content.map((child) => convertNode(child)).join('');
      return `${'#'.repeat(level)} ${inner}\n`;
    }
    case 'bulletList':
      return content
        .map((child) => `- ${convertNode(child, { type: 'bullet', index: 1 }).trim()}\n`)
        .join('');
    case 'orderedList':
      return content
        .map((child, idx) => `${idx + 1}. ${convertNode(child, { type: 'ordered', index: idx + 1 }).trim()}\n`)
        .join('');
    case 'listItem': {
      const inner = content.map((child) => convertNode(child, listState)).join('').trim();
      return inner;
    }
    case 'blockquote': {
      const inner = content.map((child) => convertNode(child)).join('').trim();
      return inner
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    }
    case 'codeBlock': {
      const language = attrs?.language ?? '';
      const inner = content.map((child) => convertNode(child)).join('');
      return `\`\`\`${language}\n${inner}\n\`\`\`\n`;
    }
    case 'panel': {
      const inner = content.map((child) => convertNode(child)).join('').trim();
      return `> ${inner}\n`;
    }
    case 'rule':
      return `---\n`;
    case 'hardBreak':
      return '\n';
    default:
      return content.map((child) => convertNode(child)).join('');
  }
}

function applyMarks(value: string, marks?: { type?: string; attrs?: Record<string, any> }[]): string {
  if (!marks || marks.length === 0) return value;
  return marks.reduce((acc, mark) => {
    switch (mark.type) {
      case 'strong':
        return `**${acc}**`;
      case 'em':
        return `*${acc}*`;
      case 'code':
        return `\`${acc}\``;
      case 'underline':
        return `__${acc}__`;
      case 'strike':
        return `~~${acc}~~`;
      case 'link':
        return `[${acc}](${mark.attrs?.href ?? '#'})`;
      default:
        return acc;
    }
  }, value);
}

