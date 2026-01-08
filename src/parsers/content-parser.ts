import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
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

export function confluenceStorageToMarkdown(html?: string): string {
  if (!html) return '';
  return turndown.turndown(html).trim();
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

