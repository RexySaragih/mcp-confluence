import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type AuthConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  try {
    const auth = loadAuth();
    await testJira(auth);
    await testConfluence(auth);
    console.log('Connection tests completed.');
  } catch (error: any) {
    console.error('Connection test failed:', error?.message ?? error);
    if (error?.stack) console.error(error.stack);
    process.exitCode = 1;
  }
}

function loadAuth(): AuthConfig {
  const baseUrl = requireEnv('ATLASSIAN_BASE_URL').replace(/\/$/, '');
  const email = requireEnv('ATLASSIAN_EMAIL');
  const apiToken = requireEnv('ATLASSIAN_API_TOKEN');
  console.log({
    baseUrl,
    email,
    apiToken,
  })
  return { baseUrl, email, apiToken };
}

async function testJira(auth: AuthConfig) {
  const url = `${auth.baseUrl}/rest/api/3/myself`;
  console.log(`Testing Jira at ${url}`);
  const response = await fetch(url, { headers: buildHeaders(auth) });
  await logResponse('Jira /myself', response);
}

async function testConfluence(auth: AuthConfig) {
  const url = `${auth.baseUrl}/wiki/api/v2/spaces?limit=1`;
  console.log(`Testing Confluence at ${url}`);
  const response = await fetch(url, { headers: buildHeaders(auth) });
  await logResponse('Confluence /spaces', response);
}

function buildHeaders(auth: AuthConfig) {
  const token = Buffer.from(`${auth.email}:${auth.apiToken}`, 'utf8').toString('base64');
  return {
    Authorization: `Basic ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function logResponse(label: string, response: Response) {
  const text = await response.text();
  const preview = text.slice(0, 400);
  if (response.ok) {
    console.log(`${label} OK (${response.status})`);
    console.log(prettyJsonSafe(preview));
  } else {
    console.error(`${label} FAILED (${response.status} ${response.statusText})`);
    console.error(prettyJsonSafe(preview));
  }
}

function prettyJsonSafe(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

void main();

