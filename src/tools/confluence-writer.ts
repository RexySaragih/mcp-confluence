import z from 'zod';
import { ConfluenceClient } from '../clients/confluence-client.js';
import { markdownToConfluenceStorage, extractMermaidFromMarkdown } from '../parsers/markdown-to-storage.js';
import { renderMermaidDiagrams } from '../renderers/mermaid-renderer.js';
import { validateDesignDoc, setTitle } from '../validators/design-doc-validator.js';

/**
 * Confluence Page Writer Tool
 * 
 * Creates or updates Confluence pages with design documents.
 * Supports:
 * - Markdown to Confluence Storage Format conversion
 * - Mermaid diagram rendering to SVG
 * - Design document validation with guardrails
 */

// Input validation schema
export const confluenceWriterInputSchema = z.object({
  space_id: z.string().describe('Confluence space ID (e.g., "ENGINEERING" or numeric ID)'),
  title: z.string().min(1).describe('Page title'),
  content: z.string().min(1).describe('Markdown content to publish'),
  parent_page_id: z.string().optional().describe('Optional parent page ID for hierarchy'),
  page_id: z.string().optional().describe('Optional page ID to update (if not provided, will search by title)'),
  labels: z.array(z.string()).optional().describe('Optional labels to add to the page'),
  validate_design_doc: z.boolean().optional().default(false).describe('Enable design document guardrails validation'),
});

export type ConfluenceWriterInput = z.infer<typeof confluenceWriterInputSchema>;

// Tool definition for MCP
export const createOrUpdateConfluencePageTool = {
  name: 'create_or_update_confluence_page',
  description: 'Creates or updates a Confluence page with Markdown content. Converts Markdown to Confluence Storage Format, renders Mermaid diagrams to SVG, and optionally validates design documents with guardrails (section validation, diagram placeholders, unknown handling, heading ordering).',
  inputSchema: {
    type: 'object',
    properties: {
      space_id: {
        type: 'string',
        description: 'Confluence space ID (e.g., "ENGINEERING" or numeric ID)',
      },
      title: {
        type: 'string',
        description: 'Page title',
      },
      content: {
        type: 'string',
        description: 'Markdown content to publish',
      },
      parent_page_id: {
        type: 'string',
        description: 'Optional parent page ID for hierarchy',
      },
      page_id: {
        type: 'string',
        description: 'Optional page ID to update (if not provided, will search by title)',
      },
      labels: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional labels to add to the page',
      },
      validate_design_doc: {
        type: 'boolean',
        description: 'Enable design document guardrails validation',
      },
    },
    required: ['space_id', 'title', 'content'],
  },
};

/**
 * Handles the create_or_update_confluence_page tool invocation.
 */
export async function handleCreateOrUpdateConfluencePage(
  client: ConfluenceClient,
  args: unknown,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  // Validate input
  const input = confluenceWriterInputSchema.parse(args);

  let processedContent = input.content;
  const validationMessages: string[] = [];

  // Step 1: Validate design document if requested
  if (input.validate_design_doc) {
    const validation = validateDesignDoc(processedContent);

    if (validation.errors.length > 0) {
      validationMessages.push('Validation errors (corrected):');
      validationMessages.push(...validation.errors.map((e) => `  - ${e}`));
    }

    if (validation.warnings.length > 0) {
      validationMessages.push('Validation warnings:');
      validationMessages.push(...validation.warnings.map((w) => `  - ${w}`));
    }

    // Use the processed content with corrections
    processedContent = validation.processedContent;
  }

  // Ensure title is in the content
  processedContent = setTitle(processedContent, input.title);

  // Step 2: Extract and render Mermaid diagrams
  const mermaidBlocks = extractMermaidFromMarkdown(processedContent);
  let mermaidSvgs = new Map<string, string>();

  if (mermaidBlocks.length > 0) {
    console.error(`Rendering ${mermaidBlocks.length} Mermaid diagram(s)...`);
    mermaidSvgs = await renderMermaidDiagrams(mermaidBlocks);
    console.error(`Successfully rendered ${mermaidSvgs.size} diagram(s)`);
  }

  // Step 3: Create or update the page first (with placeholders)
  // We'll update it again after uploading attachments
  const storageFormatWithPlaceholders = markdownToConfluenceStorage(processedContent, new Map());
  
  let result;
  let action: 'created' | 'updated';

  if (input.page_id) {
    // Update existing page by ID
    result = await client.updatePage(input.page_id, {
      title: input.title,
      body: storageFormatWithPlaceholders,
      labels: input.labels,
    });
    action = 'updated';
  } else {
    // Check if page exists by title
    const existingPage = await client.findPageByTitle(input.space_id, input.title);

    if (existingPage) {
      // Update existing page
      result = await client.updatePage(existingPage.id, {
        title: input.title,
        body: storageFormatWithPlaceholders,
        labels: input.labels,
      });
      action = 'updated';
    } else {
      // Create new page
      result = await client.createPage({
        spaceId: input.space_id,
        title: input.title,
        body: storageFormatWithPlaceholders,
        parentPageId: input.parent_page_id,
        labels: input.labels,
      });
      action = 'created';
    }
  }

  // Step 4: Upload SVG attachments and collect URLs
  const attachmentUrls = new Map<string, string>();
  if (mermaidSvgs.size > 0) {
    console.error(`Uploading ${mermaidSvgs.size} SVG attachment(s)...`);
    for (const [id, svg] of mermaidSvgs.entries()) {
      try {
        const buffer = Buffer.from(svg, 'utf8');
        const filename = `mermaid-diagram-${id}.svg`;
        const attachment = await client.uploadAttachment(result.id, buffer, filename, 'image/svg+xml');
        attachmentUrls.set(id, attachment.downloadUrl);
        console.error(`Uploaded attachment: ${filename} (ID: ${attachment.id}, URL: ${attachment.downloadUrl})`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Failed to upload attachment for diagram ${id}:`, errorMessage);
      }
    }
  }

  // Step 5: Update page with embedded images
  if (attachmentUrls.size > 0) {
    console.error(`Updating page with embedded diagram images...`);
    const storageFormatWithImages = markdownToConfluenceStorage(processedContent, attachmentUrls);
    await client.updatePage(result.id, {
      title: input.title,
      body: storageFormatWithImages,
      labels: input.labels,
    });
  }

  // Build response
  const responseLines = [
    `Page ${action} successfully!`,
    '',
    `Title: ${result.title}`,
    `URL: ${result.url}`,
    `Page ID: ${result.id}`,
    `Version: ${result.version}`,
  ];

  if (mermaidBlocks.length > 0) {
    responseLines.push('');
    responseLines.push(`Mermaid diagrams: ${mermaidBlocks.length} found, ${mermaidSvgs.size} rendered`);
  }

  if (input.labels?.length) {
    responseLines.push(`Labels: ${input.labels.join(', ')}`);
  }

  if (validationMessages.length > 0) {
    responseLines.push('');
    responseLines.push('Design Document Validation:');
    responseLines.push(...validationMessages);
  }

  return {
    content: [{ type: 'text', text: responseLines.join('\n') }],
  };
}

