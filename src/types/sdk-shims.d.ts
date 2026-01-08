declare module '@modelcontextprotocol/sdk/dist/cjs/server/mcp.js' {
  import type { Implementation, ServerOptions } from '@modelcontextprotocol/sdk/dist/cjs/server/index.js';
  import type { Transport } from '@modelcontextprotocol/sdk/dist/cjs/shared/transport.js';
  import type { AnySchema, AnyObjectSchema, ZodRawShapeCompat, SchemaOutput, ShapeOutput } from '@modelcontextprotocol/sdk/dist/cjs/server/zod-compat.js';
  import type { ToolAnnotations } from '@modelcontextprotocol/sdk/dist/cjs/types.js';
  export class McpServer {
    constructor(serverInfo: Implementation, options?: ServerOptions);
    connect(transport: Transport): Promise<void>;
    close(): Promise<void>;
    registerTool<OutputArgs extends ZodRawShapeCompat | AnySchema, InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined>(
      name: string,
      config: {
        title?: string;
        description?: string;
        inputSchema?: InputArgs;
        outputSchema?: OutputArgs;
        annotations?: ToolAnnotations;
        _meta?: Record<string, unknown>;
      },
      cb: (args: ShapeOutput<InputArgs>, extra: unknown) => Promise<unknown>,
    ): void;
  }
}

declare module '@modelcontextprotocol/sdk/dist/cjs/server/stdio.js' {
  import type { Transport } from '@modelcontextprotocol/sdk/dist/cjs/shared/transport.js';
  export class StdioServerTransport implements Transport {
    constructor();
    start(): Promise<void>;
    close(): Promise<void>;
    send(message: unknown): Promise<void>;
    onmessage?: (message: unknown) => void;
    onerror?: (error: unknown) => void;
    onclose?: () => void;
  }
}

