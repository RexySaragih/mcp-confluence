import { spawn } from 'node:child_process';
import { writeFile, readFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Renders Mermaid diagram code to SVG using mermaid-cli.
 * 
 * This module spawns the mmdc (mermaid-cli) process to convert
 * Mermaid diagram syntax into SVG images that can be embedded
 * in Confluence pages.
 */

export interface MermaidRenderResult {
  id: string;
  svg: string;
  success: boolean;
  error?: string;
}

/**
 * Renders a single Mermaid diagram to SVG.
 * @param id - Unique identifier for the diagram
 * @param mermaidCode - The Mermaid diagram code
 * @returns The rendered SVG or an error
 */
export async function renderMermaidToSvg(
  id: string,
  mermaidCode: string,
): Promise<MermaidRenderResult> {
  let tempDir: string | null = null;

  try {
    // Create a temporary directory for this render
    tempDir = await mkdtemp(path.join(tmpdir(), 'mermaid-'));
    const inputFile = path.join(tempDir, `${id}.mmd`);
    const outputFile = path.join(tempDir, `${id}.svg`);

    // Write the mermaid code to a temp file
    await writeFile(inputFile, mermaidCode, 'utf8');

    // Run mermaid-cli
    await runMermaidCli(inputFile, outputFile);

    // Read the generated SVG
    const svg = await readFile(outputFile, 'utf8');

    // Clean up temp files
    await cleanupTempFiles(inputFile, outputFile);

    return {
      id,
      svg: cleanSvg(svg),
      success: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to render mermaid diagram ${id}:`, errorMessage);

    return {
      id,
      svg: '',
      success: false,
      error: errorMessage,
    };
  } finally {
    // Try to clean up temp directory
    if (tempDir) {
      try {
        await unlink(tempDir).catch(() => {});
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Renders multiple Mermaid diagrams to SVG in parallel.
 * @param diagrams - Array of { id, code } objects
 * @returns Map of diagram IDs to SVG content
 */
export async function renderMermaidDiagrams(
  diagrams: { id: string; code: string }[],
): Promise<Map<string, string>> {
  const results = await Promise.all(
    diagrams.map(({ id, code }) =>
      renderMermaidToSvg(id, sanitizeMermaidCode(code)),
    ),
  );

  const svgMap = new Map<string, string>();
  for (const result of results) {
    if (result.success && result.svg) {
      svgMap.set(result.id, result.svg);
    }
  }

  return svgMap;
}

/**
 * Runs the mermaid-cli (mmdc) command to convert a .mmd file to SVG.
 * Uses npx by default since mmdc may not be in PATH.
 */
function runMermaidCli(inputPath: string, outputPath: string): Promise<void> {
  // Use npx directly since mmdc may not be in PATH
  // This matches how users typically run mermaid-cli
  return runWithNpx(inputPath, outputPath);
}

/**
 * Run mermaid-cli using npx (default method).
 */
function runWithNpx(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

    const args = [
      '--yes',
      '@mermaid-js/mermaid-cli',
      '-i', inputPath,
      '-o', outputPath,
      '-b', 'transparent',
      // Removed --quiet to see error messages
    ];

    const child = spawn(npx, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Add timeout (30 seconds)
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`mermaid-cli timed out after 30s. stdout: ${stdout.substring(0, 500)}, stderr: ${stderr.substring(0, 500)}`));
    }, 30000);

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to run mermaid-cli via npx: ${error.message}`));
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        const errorMsg = signal 
          ? `Process killed by signal ${signal}`
          : `mermaid-cli exited with code ${code}`;
        const output = stdout || stderr;
        reject(new Error(`${errorMsg}. Output: ${output.substring(0, 1000)}`));
      }
    });
  });
}

/**
 * Cleans up temporary files.
 */
async function cleanupTempFiles(...files: string[]): Promise<void> {
  for (const file of files) {
    try {
      await unlink(file);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Cleans the SVG output:
 * - Removes XML declaration
 * - Removes unnecessary whitespace
 * - Ensures viewBox is set for proper scaling
 */
function cleanSvg(svg: string): string {
  // Remove XML declaration
  let cleaned = svg.replace(/<\?xml[^?]*\?>\s*/g, '');

  // Remove DOCTYPE if present
  cleaned = cleaned.replace(/<!DOCTYPE[^>]*>\s*/g, '');

  // Trim whitespace
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Sanitizes Mermaid diagram code before rendering.
 * - Normalizes line endings
 * - Strips non-printable characters
 * - Replaces "smart quotes" with normal quotes
 * - Fixes edge labels with parentheses by wrapping them in quotes
 */
function sanitizeMermaidCode(code: string): string {
  let sanitized = code;

  // Normalize CRLF/CR to LF
  sanitized = sanitized.replace(/\r\n?/g, '\n');

  // Remove non-printable characters (except tab/newline)
  sanitized = sanitized.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');

  // Normalize smart quotes to plain quotes
  sanitized = sanitized
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'");

  // Fix edge labels that contain parentheses by wrapping them in quotes
  // Pattern: |label with (parens)| -> |"label with (parens)"|
  // This prevents parsing errors when parentheses appear in edge labels
  sanitized = sanitized.replace(
    /\|([^|]*\([^|]*\)[^|]*)\|/g,
    (match, labelContent) => {
      // If the label content already has quotes, don't double-wrap
      const trimmed = labelContent.trim();
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
          (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return match;
      }
      // Wrap in quotes to prevent parsing errors
      return `|"${labelContent}"|`;
    },
  );

  // Trim trailing whitespace on each line
  sanitized = sanitized
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n');

  return sanitized.trim();
}

/**
 * Creates a placeholder SVG for when rendering fails.
 */
export function createPlaceholderSvg(
  diagramType: string,
  errorMessage?: string,
): string {
  const message = errorMessage
    ? `Diagram rendering failed: ${errorMessage}`
    : `${diagramType} diagram placeholder`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 400 100">
  <rect width="100%" height="100%" fill="#f0f0f0" stroke="#ccc" stroke-width="2" rx="5"/>
  <text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#666" font-family="sans-serif" font-size="14">
    ${message}
  </text>
</svg>`;
}

