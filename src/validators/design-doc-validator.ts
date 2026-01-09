import { ValidationResult, DesignDocSection } from '../types/index.js';

/**
 * Design Document Validator
 * 
 * Implements guardrails for design document generation:
 * - Section validation (no empty sections)
 * - Architecture diagram placeholders
 * - Explicit "unknown" handling
 * - Deterministic headings order
 */

/**
 * Canonical section order for design documents.
 * Sections will be reordered to match this order.
 */
const CANONICAL_SECTIONS: DesignDocSection[] = [
  { heading: 'Overview', content: '', required: true },
  { heading: 'Goals', content: '', required: true },
  { heading: 'Non-Goals', content: '', required: false },
  { heading: 'Background', content: '', required: false },
  { heading: 'Architecture', content: '', required: true },
  { heading: 'Data Flow', content: '', required: false },
  { heading: 'API Changes', content: '', required: false },
  { heading: 'Security Considerations', content: '', required: true },
  { heading: 'Testing Strategy', content: '', required: true },
  { heading: 'Rollout Plan', content: '', required: false },
  { heading: 'Open Questions', content: '', required: false },
];

/**
 * Patterns that indicate content is not properly filled in.
 */
const INCOMPLETE_PATTERNS = [
  /^TBD$/i,
  /^TODO$/i,
  /^TBA$/i,
  /^N\/A$/i,
  /^\[.*\]$/,  // [placeholder]
  /^-+$/,      // Just dashes
  /^\s*$/,     // Empty or whitespace only
];

/**
 * Validates and processes a design document.
 * 
 * @param content - The markdown content of the design document
 * @returns Validation result with processed content
 */
export function validateDesignDoc(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Parse sections from the content
  const sections = parseSections(content);

  // Check for required sections
  for (const canonical of CANONICAL_SECTIONS) {
    if (canonical.required) {
      const found = sections.find(
        (s) => normalizeHeading(s.heading) === normalizeHeading(canonical.heading),
      );
      if (!found) {
        errors.push(`Missing required section: "${canonical.heading}"`);
      }
    }
  }

  // Validate each section
  for (const section of sections) {
    const validation = validateSection(section);
    if (validation.error) {
      errors.push(validation.error);
    }
    if (validation.warning) {
      warnings.push(validation.warning);
    }
  }

  // Check for architecture diagram
  const archSection = sections.find(
    (s) => normalizeHeading(s.heading) === 'architecture',
  );
  if (archSection && !hasDiagram(archSection.content)) {
    warnings.push('Architecture section does not contain a diagram');
  }

  // Reorder sections to canonical order
  const reorderedSections = reorderSections(sections);

  // Apply "Not applicable" handling for empty sections
  const processedSections = reorderedSections.map((section) => {
    if (isIncomplete(section.content)) {
      return {
        ...section,
        content: generateNotApplicable(section.heading),
      };
    }
    return section;
  });

  // Ensure architecture diagram placeholder if missing
  const processedArch = processedSections.find(
    (s) => normalizeHeading(s.heading) === 'architecture',
  );
  if (processedArch && !hasDiagram(processedArch.content)) {
    processedArch.content = insertDiagramPlaceholder(processedArch.content);
  }

  // Rebuild the markdown content
  const processedContent = buildMarkdown(processedSections);

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    processedContent,
  };
}

/**
 * Parses markdown content into sections.
 */
function parseSections(content: string): DesignDocSection[] {
  const sections: DesignDocSection[] = [];
  const lines = content.split('\n');

  let currentHeading = '';
  let currentContent: string[] = [];
  let inSection = false;

  for (const line of lines) {
    // Check for heading (## or #)
    const headingMatch = line.match(/^#{1,2}\s+(.+)$/);

    if (headingMatch) {
      // Save previous section if exists
      if (inSection && currentHeading) {
        sections.push({
          heading: currentHeading,
          content: currentContent.join('\n').trim(),
          required: isRequiredSection(currentHeading),
        });
      }

      currentHeading = headingMatch[1].trim();
      currentContent = [];
      inSection = true;
    } else if (inSection) {
      currentContent.push(line);
    }
  }

  // Don't forget the last section
  if (inSection && currentHeading) {
    sections.push({
      heading: currentHeading,
      content: currentContent.join('\n').trim(),
      required: isRequiredSection(currentHeading),
    });
  }

  return sections;
}

/**
 * Validates a single section.
 */
function validateSection(section: DesignDocSection): {
  error?: string;
  warning?: string;
} {
  // Check if section is empty
  if (!section.content.trim()) {
    if (section.required) {
      return { error: `Required section "${section.heading}" is empty` };
    }
    return { warning: `Section "${section.heading}" is empty` };
  }

  // Check for incomplete patterns
  const contentTrimmed = section.content.trim();
  for (const pattern of INCOMPLETE_PATTERNS) {
    if (pattern.test(contentTrimmed)) {
      if (section.required) {
        return {
          error: `Required section "${section.heading}" contains only placeholder content`,
        };
      }
      return {
        warning: `Section "${section.heading}" contains placeholder content`,
      };
    }
  }

  return {};
}

/**
 * Checks if a section is required.
 */
function isRequiredSection(heading: string): boolean {
  const normalized = normalizeHeading(heading);
  return CANONICAL_SECTIONS.some(
    (s) => normalizeHeading(s.heading) === normalized && s.required,
  );
}

/**
 * Normalizes a heading for comparison.
 */
function normalizeHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Checks if content contains a diagram.
 */
function hasDiagram(content: string): boolean {
  // Check for mermaid code blocks
  if (/```mermaid/i.test(content)) return true;

  // Check for image references
  if (/!\[.*\]\(.*\)/.test(content)) return true;

  // Check for [DIAGRAM] placeholder
  if (/\[DIAGRAM\]/i.test(content)) return true;

  return false;
}

/**
 * Checks if content is incomplete.
 */
function isIncomplete(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;

  for (const pattern of INCOMPLETE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  return false;
}

/**
 * Generates "Not applicable" content with explanation.
 */
function generateNotApplicable(heading: string): string {
  const reasons: Record<string, string> = {
    'non-goals': 'No explicit non-goals have been identified for this feature.',
    background: 'No additional background context is required for this design.',
    'data flow': 'The data flow is straightforward and does not require detailed documentation.',
    'api changes': 'This design does not introduce any API changes.',
    'rollout plan': 'A detailed rollout plan will be created closer to the release date.',
    'open questions': 'All questions have been resolved during the design process.',
  };

  const normalizedHeading = normalizeHeading(heading);
  const reason =
    reasons[normalizedHeading] ||
    `This section could not be inferred from the available codebase information.`;

  return `**Not applicable:** ${reason}`;
}

/**
 * Inserts a diagram placeholder in the content.
 */
function insertDiagramPlaceholder(content: string): string {
  const placeholder = `

> **[Architecture Diagram Placeholder]**
> 
> A Mermaid diagram should be generated here to visualize the system architecture.
> Use the \`\`\`mermaid code block syntax to add a flowchart or sequence diagram.

`;

  // Insert after the first paragraph or at the beginning
  const firstParagraphEnd = content.indexOf('\n\n');
  if (firstParagraphEnd > 0) {
    return (
      content.slice(0, firstParagraphEnd) +
      placeholder +
      content.slice(firstParagraphEnd)
    );
  }

  return placeholder + content;
}

/**
 * Reorders sections to match canonical order.
 */
function reorderSections(sections: DesignDocSection[]): DesignDocSection[] {
  const ordered: DesignDocSection[] = [];
  const remaining = [...sections];

  // First, add sections in canonical order
  for (const canonical of CANONICAL_SECTIONS) {
    const index = remaining.findIndex(
      (s) => normalizeHeading(s.heading) === normalizeHeading(canonical.heading),
    );
    if (index !== -1) {
      ordered.push(remaining.splice(index, 1)[0]);
    }
  }

  // Then add any remaining sections that weren't in the canonical list
  ordered.push(...remaining);

  return ordered;
}

/**
 * Builds markdown from sections.
 */
function buildMarkdown(sections: DesignDocSection[]): string {
  return sections
    .map((section) => `## ${section.heading}\n\n${section.content}`)
    .join('\n\n');
}

/**
 * Extracts the title from markdown content.
 * Returns the first H1 heading or null.
 */
export function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Adds or updates the title in markdown content.
 */
export function setTitle(content: string, title: string): string {
  const hasTitle = /^#\s+.+$/m.test(content);

  if (hasTitle) {
    return content.replace(/^#\s+.+$/m, `# ${title}`);
  }

  return `# ${title}\n\n${content}`;
}

