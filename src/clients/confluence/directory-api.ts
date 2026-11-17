import { ConfluenceSpace } from '../../types/index.js';
import { AtlassianHttp } from '../atlassian-http.js';
import { RawList, RawSpace, RawUser } from './raw-types.js';

const USER_LOOKUP_BATCH_SIZE = 100;

/** Spaces and users: the lookups needed to place pages and name people. */
export class ConfluenceDirectoryApi {
  constructor(private readonly http: AtlassianHttp) {}

  async spaceByKey(key: string): Promise<ConfluenceSpace> {
    const raw = await this.http.json<RawList<RawSpace>>(
      `/wiki/api/v2/spaces?keys=${encodeURIComponent(key)}&limit=1`,
      { errorContext: `Failed to look up space ${key}` },
    );
    const space = raw.results?.[0];
    if (!space) {
      throw new Error(`Space "${key}" was not found, or you do not have permission to view it.`);
    }
    return toSpace(space);
  }

  async spaceById(spaceId: string): Promise<ConfluenceSpace> {
    const raw = await this.http.json<RawSpace>(`/wiki/api/v2/spaces/${encodeURIComponent(spaceId)}`, {
      errorContext: `Failed to look up space ${spaceId}`,
    });
    return toSpace(raw);
  }

  async userDisplayNames(accountIds: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (let start = 0; start < accountIds.length; start += USER_LOOKUP_BATCH_SIZE) {
      const batch = accountIds.slice(start, start + USER_LOOKUP_BATCH_SIZE);
      const raw = await this.http.json<RawList<RawUser>>('/wiki/api/v2/users-bulk', {
        method: 'POST',
        body: { accountIds: batch },
        errorContext: 'Failed to look up user names',
      });
      for (const user of raw.results ?? []) {
        const name = user.displayName || user.publicName;
        if (user.accountId && name) names.set(user.accountId, name);
      }
    }
    return names;
  }
}

function toSpace(raw: RawSpace): ConfluenceSpace {
  return { id: String(raw.id), key: raw.key, name: raw.name ?? raw.key, homepageId: raw.homepageId };
}
