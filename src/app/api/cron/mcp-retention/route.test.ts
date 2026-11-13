import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const purgeMcpData = vi.hoisted(() => vi.fn(async () => ({ audit: 3, tokens: 2, codes: 1, clients: 4 })));
vi.mock('@/lib/mcp/retention', () => ({ purgeMcpData }));

import { GET } from './route';

const SECRET = 'test-cron-secret-value';
const call = (query = '') => GET(new Request(`http://localhost/api/cron/mcp-retention${query}`));
let previous: string | undefined;

beforeEach(() => {
  previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
  purgeMcpData.mockClear();
});

afterEach(() => {
  if (previous === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previous;
});

describe('GET /api/cron/mcp-retention', () => {
  it('lehnt Aufrufe ohne Secret mit 401 ab und löscht nichts', async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(purgeMcpData).not.toHaveBeenCalled();
  });

  it('lehnt ein falsches Secret mit 401 ab', async () => {
    expect((await call('?secret=falsch')).status).toBe(401);
    expect((await call(`?secret=${SECRET}x`)).status).toBe(401);
    expect(purgeMcpData).not.toHaveBeenCalled();
  });

  it('lehnt jeden Aufruf ab, solange CRON_SECRET nicht gesetzt ist', async () => {
    delete process.env.CRON_SECRET;
    expect((await call('?secret=')).status).toBe(401);
    expect((await call('?secret=undefined')).status).toBe(401);
    expect(purgeMcpData).not.toHaveBeenCalled();
  });

  it('liefert mit richtigem Secret die Löschzahlen', async () => {
    const res = await call(`?secret=${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, audit: 3, tokens: 2, codes: 1, clients: 4 });
    expect(purgeMcpData).toHaveBeenCalledTimes(1);
  });
});
