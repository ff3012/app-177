import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { DEFAULT_DRINK_PRODUCTS } from './notification-form-constants';
import {
  getNotificationFormSetting,
  getNotificationFormSettings,
  getNotificationFormStates,
  saveDrinkProducts,
  saveNotificationFormEnabled,
  saveNotificationFormRecipients,
} from './notification-form-settings';

const RUN = `nfs-${Date.now()}`;
const orgIds: string[] = [];
let feuerwehrId = '';
let abschnittId = '';

async function makeOrg(key: string, type: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO') {
  const org = await prisma.organization.create({ data: { name: `${RUN}-${key}`, nummer: `${RUN}-${key}`, type } });
  orgIds.push(org.id);
  return org.id;
}

beforeAll(async () => {
  feuerwehrId = await makeOrg('ff', 'FEUERWEHR');
  abschnittId = await makeOrg('afkdo', 'ABSCHNITTSKOMMANDO');
});

afterAll(async () => {
  if (orgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe('Einstellungen der Meldeformulare', () => {
  it('ohne Zeile: eingeschaltet, keine Empfänger (norecipient), Standardprodukte', async () => {
    expect(await getNotificationFormSettings(feuerwehrId)).toEqual({
      DRINKS: { enabled: true, recipients: [], products: [...DEFAULT_DRINK_PRODUCTS] },
      DAMAGE: { enabled: true, recipients: [], products: [] },
    });
    expect(await getNotificationFormStates(feuerwehrId)).toEqual({ DRINKS: 'norecipient', DAMAGE: 'norecipient' });
  });

  it('Empfänger machen ein Formular verfügbar; abgeschaltet ist es "off", die Empfänger bleiben', async () => {
    await saveNotificationFormRecipients(feuerwehrId, 'DAMAGE', ['a@example.local', 'a@example.local', 'b@example.local']);
    expect((await getNotificationFormSetting(feuerwehrId, 'DAMAGE')).recipients).toEqual(['a@example.local', 'b@example.local']);
    expect((await getNotificationFormStates(feuerwehrId)).DAMAGE).toBe('available');

    await saveNotificationFormEnabled(feuerwehrId, 'DAMAGE', false);
    expect((await getNotificationFormStates(feuerwehrId)).DAMAGE).toBe('off');
    expect((await getNotificationFormSetting(feuerwehrId, 'DAMAGE')).recipients).toEqual(['a@example.local', 'b@example.local']);
    await saveNotificationFormEnabled(feuerwehrId, 'DAMAGE', true);
    expect((await getNotificationFormStates(feuerwehrId)).DAMAGE).toBe('available');
  });

  it('hält die Formulare getrennt: der Getränkeautomat bleibt unberührt', async () => {
    expect((await getNotificationFormSetting(feuerwehrId, 'DRINKS')).recipients).toEqual([]);
    await saveNotificationFormRecipients(feuerwehrId, 'DRINKS', ['c@example.local']);
    expect((await getNotificationFormSetting(feuerwehrId, 'DAMAGE')).recipients).toEqual(['a@example.local', 'b@example.local']);
  });

  it('speichert die Produktliste, leer = Standardprodukte, und lehnt ungültige Listen ab', async () => {
    await saveDrinkProducts(feuerwehrId, ['  Cola ', 'Wasser', 'cola']);
    expect((await getNotificationFormSetting(feuerwehrId, 'DRINKS')).products).toEqual(['Cola', 'Wasser']);
    expect((await getNotificationFormSetting(feuerwehrId, 'DRINKS')).recipients).toEqual(['c@example.local']);

    await saveDrinkProducts(feuerwehrId, []);
    expect((await getNotificationFormSetting(feuerwehrId, 'DRINKS')).products).toEqual([...DEFAULT_DRINK_PRODUCTS]);

    await expect(saveDrinkProducts(feuerwehrId, ['a'.repeat(31)])).rejects.toThrow('höchstens 30 Zeichen');
    await expect(saveDrinkProducts(feuerwehrId, 'Bier')).rejects.toThrow('Ungültige Eingabe.');
  });

  it('lehnt unbekannte Formulare und Organisationen ab, die keine Feuerwehr sind', async () => {
    await expect(saveNotificationFormEnabled(feuerwehrId, 'INCIDENT', true)).rejects.toThrow('nicht verfügbar');
    await expect(saveNotificationFormRecipients(feuerwehrId, 'FOO', [])).rejects.toThrow('nicht verfügbar');
    await expect(saveNotificationFormEnabled(abschnittId, 'DRINKS', false)).rejects.toThrow('nur für Feuerwehren');
    await expect(saveDrinkProducts(abschnittId, ['Bier'])).rejects.toThrow('nur für Feuerwehren');
  });
});
