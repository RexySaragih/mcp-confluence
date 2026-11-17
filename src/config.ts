import path from 'node:path';

export interface AppConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  readOnly: boolean;
  contentDirs: string[];
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    baseUrl: normalizeBaseUrl(requireEnv(env, 'ATLASSIAN_BASE_URL')),
    email: requireEnv(env, 'ATLASSIAN_EMAIL'),
    apiToken: requireEnv(env, 'ATLASSIAN_API_TOKEN'),
    readOnly: TRUE_VALUES.has((env.ATLASSIAN_READ_ONLY ?? '').trim().toLowerCase()),
    contentDirs: parseContentDirs(env.ATLASSIAN_CONTENT_DIRS),
  };
}

export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`ATLASSIAN_BASE_URL is not a valid URL: ${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`ATLASSIAN_BASE_URL must use https: ${value}`);
  }
  // Users often paste the Confluence URL (".../wiki"); both APIs need the site root.
  const sitePath = url.pathname.replace(/\/+$/, '').replace(/\/wiki$/i, '');
  return `${url.origin}${sitePath}`;
}

function parseContentDirs(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(path.delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean)
    .map((dir) => path.resolve(dir));
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
