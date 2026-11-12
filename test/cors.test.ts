import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const previousDataDir = process.env.DATA_DIR;
const previousPublicUrl = process.env.PUBLIC_URL;
const dataDir = mkdtempSync(join(tmpdir(), 'postmark-cors-'));
process.env.DATA_DIR = dataDir;
process.env.PUBLIC_URL = 'http://localhost:8787';
const [{ app }, { db }] = await Promise.all([import('../server/app.ts'), import('../server/db.ts')]);

afterAll(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  if (previousPublicUrl === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = previousPublicUrl;
});

describe('API CORS preflight', () => {
  it('allows credentialed requests from the configured frontend origin', async () => {
    const response = await app.request('/api/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:8787',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:8787');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('does not grant another origin access', async () => {
    const response = await app.request('/api/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://attacker.example',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
