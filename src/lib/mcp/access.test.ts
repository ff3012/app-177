import { describe, expect, it } from 'vitest';
import { hasMcpAccess, mcpRank, parseMcpAccess } from './access';

describe('mcpRank / hasMcpAccess', () => {
  it('ordnet NONE < READ < WRITE', () => {
    expect(mcpRank('NONE')).toBe(0);
    expect(mcpRank('READ')).toBe(1);
    expect(mcpRank('WRITE')).toBe(2);
  });

  it('WRITE schließt READ ein, READ schließt WRITE nicht ein', () => {
    expect(hasMcpAccess('WRITE', 'READ')).toBe(true);
    expect(hasMcpAccess('READ', 'READ')).toBe(true);
    expect(hasMcpAccess('READ', 'WRITE')).toBe(false);
    expect(hasMcpAccess('NONE', 'READ')).toBe(false);
  });
});

describe('parseMcpAccess', () => {
  it('übernimmt exakt die drei gültigen Werte', () => {
    expect(parseMcpAccess('NONE')).toBe('NONE');
    expect(parseMcpAccess('READ')).toBe('READ');
    expect(parseMcpAccess('WRITE')).toBe('WRITE');
  });

  it('liefert undefined für fehlende oder ungültige Werte (nie stillschweigend NONE)', () => {
    expect(parseMcpAccess(null)).toBeUndefined();
    expect(parseMcpAccess(undefined)).toBeUndefined();
    expect(parseMcpAccess('read')).toBeUndefined();
    expect(parseMcpAccess('ADMIN')).toBeUndefined();
    expect(parseMcpAccess(2)).toBeUndefined();
  });
});
