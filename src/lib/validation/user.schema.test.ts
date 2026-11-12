import { describe, expect, it } from 'vitest';
import { parseUserFormData, userSchema } from './user.schema';

function form(extra: Record<string, string> = {}): FormData {
  const data = new FormData();
  const base: Record<string, string> = {
    firstName: 'Max',
    lastName: 'Muster',
    email: 'max@example.local',
    stbNr: '12',
    homeOrganizationId: 'org-1',
    droneRole: 'NONE',
    ...extra,
  };
  for (const [key, value] of Object.entries(base)) data.set(key, value);
  return data;
}

describe('parseUserFormData - mcpAccess', () => {
  it('liefert undefined, wenn das Feld fehlt (der Server lässt den Wert dann unverändert)', () => {
    expect(parseUserFormData(form()).mcpAccess).toBeUndefined();
  });

  it('übernimmt gültige Werte', () => {
    expect(parseUserFormData(form({ mcpAccess: 'NONE' })).mcpAccess).toBe('NONE');
    expect(parseUserFormData(form({ mcpAccess: 'READ' })).mcpAccess).toBe('READ');
    expect(parseUserFormData(form({ mcpAccess: 'WRITE' })).mcpAccess).toBe('WRITE');
  });

  it('liefert bei ungültigem Wert undefined statt NONE', () => {
    expect(parseUserFormData(form({ mcpAccess: 'ADMIN' })).mcpAccess).toBeUndefined();
  });
});

describe('userSchema - mcpAccess', () => {
  it('akzeptiert das Formular ohne mcpAccess', () => {
    expect(userSchema.safeParse(parseUserFormData(form())).success).toBe(true);
  });

  it('akzeptiert READ und lässt den Wert im Ergebnis stehen', () => {
    const parsed = userSchema.safeParse(parseUserFormData(form({ mcpAccess: 'READ' })));
    expect(parsed.success && parsed.data.mcpAccess).toBe('READ');
  });
});
