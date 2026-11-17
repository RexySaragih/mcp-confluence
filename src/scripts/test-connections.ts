// Manual credential check: npm run check:connection (reads .env in the project root if present).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type AuthConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
};

const PREVIEW_CHARS = 400;
const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  try {
    const auth = loadAuth();
    console.log(`Site: ${auth.baseUrl}`);
    console.log(`Email: ${auth.email}`);
    console.log(`API token: set (${auth.apiToken.length} characters)`);
    await check('Jira /myself', `${auth.baseUrl}/rest/api/3/myself`, auth);
    await check('Confluence /spaces', `${auth.baseUrl}/wiki/api/v2/spaces?limit=1`, auth);
    console.log('Connection tests completed.');
  } catch (error) {
    console.error('Connection test failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

function loadAuth(): AuthConfig {
  return {
    baseUrl: requireEnv('ATLASSIAN_BASE_URL').replace(/\/+$/, '').replace(/\/wiki$/i, ''),
    email: requireEnv('ATLASSIAN_EMAIL'),
    apiToken: requireEnv('ATLASSIAN_API_TOKEN'),
  };
}

async function check(label: string, url: string, auth: AuthConfig): Promise<void> {
  const token = Buffer.from(`${auth.email}:${auth.apiToken}`, 'utf8').toString('base64');
  const response = await fetch(url, { headers: { Authorization: `Basic ${token}`, Accept: 'application/json' } });
  const preview = (await response.text()).slice(0, PREVIEW_CHARS);
  if (response.ok) {
    console.log(`${label} OK (${response.status})`);
  } else {
    console.error(`${label} FAILED (${response.status} ${response.statusText})\n${preview}`);
    process.exitCode = 1;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

void main();
