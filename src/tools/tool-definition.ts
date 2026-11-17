import z from 'zod';

export type TextContent = { type: 'text'; text: string };
export type ImageContent = { type: 'image'; data: string; mimeType: string };

export interface ToolResult<Content extends TextContent | ImageContent = TextContent | ImageContent> {
  content: Content[];
  isError?: boolean;
}

export type TextToolResult = ToolResult<TextContent>;

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: 'object'; [key: string]: unknown };
  annotations: ToolAnnotations;
}

interface ToolSpec {
  name: string;
  description: string;
  schema: z.ZodType;
  annotations: ToolAnnotations;
}

/** Builds the MCP tool listing from the same zod schema the handler validates with. */
export function defineTool(spec: ToolSpec): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: toInputSchema(spec.name, spec.schema),
    annotations: spec.annotations,
  };
}

function toInputSchema(name: string, schema: z.ZodType): ToolDefinition['inputSchema'] {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  if (json.type !== 'object') {
    throw new Error(`Tool ${name} must have an object input schema`);
  }
  return json as ToolDefinition['inputSchema'];
}

export function readOnlyTool(title: string): ToolAnnotations {
  return { title, readOnlyHint: true, openWorldHint: true };
}

export function additiveWriteTool(title: string): ToolAnnotations {
  return { title, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
}

export function destructiveWriteTool(title: string): ToolAnnotations {
  return { title, readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
}

export function textResult(text: string): TextToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(text: string): TextToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
