import { promises as fs } from 'node:fs';
import path from 'node:path';

const ALLOWED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.html', '.xhtml', '.xml']);
export const MAX_CONTENT_FILE_BYTES = 1024 * 1024;

/**
 * Reads page content from a local file. Only absolute paths to regular text
 * files are accepted, and ATLASSIAN_CONTENT_DIRS (when set) limits which
 * directories may be read.
 */
export async function readContentFile(filePath: string, allowedDirs: readonly string[]): Promise<string> {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`content_file must be an absolute path: ${filePath}`);
  }
  assertAllowedExtension(filePath);
  const realPath = await resolveExistingPath(filePath);
  assertAllowedExtension(realPath);
  await assertInsideAllowedDirs(realPath, allowedDirs);

  const stats = await fs.stat(realPath);
  if (!stats.isFile()) throw new Error(`content_file is not a regular file: ${filePath}`);
  if (stats.size > MAX_CONTENT_FILE_BYTES) {
    throw new Error(`content_file is ${stats.size} bytes, above the ${MAX_CONTENT_FILE_BYTES}-byte limit: ${filePath}`);
  }
  return fs.readFile(realPath, 'utf8');
}

function assertAllowedExtension(filePath: string): void {
  const extension = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(
      `content_file must end in one of ${[...ALLOWED_EXTENSIONS].join(', ')}: ${filePath}`,
    );
  }
}

async function resolveExistingPath(filePath: string): Promise<string> {
  try {
    return await fs.realpath(filePath);
  } catch {
    throw new Error(`content_file was not found: ${filePath}`);
  }
}

async function assertInsideAllowedDirs(realPath: string, allowedDirs: readonly string[]): Promise<void> {
  if (allowedDirs.length === 0) return;
  for (const dir of allowedDirs) {
    const realDir = await fs.realpath(dir).catch(() => path.resolve(dir));
    const relative = path.relative(realDir, realPath);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return;
  }
  throw new Error(`content_file must be inside one of the directories in ATLASSIAN_CONTENT_DIRS: ${realPath}`);
}
