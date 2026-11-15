import type { NotificationForm } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  NOTIFICATION_FORMS,
  isNotificationForm,
  notificationFormState,
  parseDrinkProducts,
  resolveProducts,
  type NotificationFormState,
} from './notification-form-constants';

export interface NotificationFormSettingValue {
  enabled: boolean;
  recipients: string[];
  /** Nur DRINKS (bereits aufgelöst: leer gespeichert = Standardprodukte); bei DAMAGE immer leer. */
  products: string[];
}

/** Reine Logik: Einstellung je Formular; fehlende Zeile = eingeschaltet, keine Empfänger, Standardprodukte. */
export function resolveNotificationFormSettings(
  rows: { form: string; enabled: boolean; recipients: string[]; products: string[] }[],
): Record<NotificationForm, NotificationFormSettingValue> {
  const entries = NOTIFICATION_FORMS.map((form) => {
    const row = rows.find((candidate) => candidate.form === form);
    const products = form === 'DRINKS' ? resolveProducts(row?.products ?? []) : [];
    return [form, { enabled: row ? row.enabled : true, recipients: row ? [...row.recipients] : [], products }] as const;
  });
  return Object.fromEntries(entries) as Record<NotificationForm, NotificationFormSettingValue>;
}

export async function getNotificationFormSettings(organizationId: string): Promise<Record<NotificationForm, NotificationFormSettingValue>> {
  const rows = await prisma.notificationFormSetting.findMany({
    where: { organizationId },
    select: { form: true, enabled: true, recipients: true, products: true },
  });
  return resolveNotificationFormSettings(rows);
}

export async function getNotificationFormSetting(organizationId: string, form: NotificationForm): Promise<NotificationFormSettingValue> {
  return (await getNotificationFormSettings(organizationId))[form];
}

export async function getNotificationFormStates(organizationId: string): Promise<Record<NotificationForm, NotificationFormState>> {
  const settings = await getNotificationFormSettings(organizationId);
  return Object.fromEntries(NOTIFICATION_FORMS.map((form) => [form, notificationFormState(settings[form])])) as Record<
    NotificationForm,
    NotificationFormState
  >;
}

async function assertConfigurable(organizationId: string, form: string): Promise<NotificationForm> {
  if (!isNotificationForm(form)) throw new Error('Dieses Formular ist nicht verfügbar.');
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, type: 'FEUERWEHR' },
    select: { id: true },
  });
  if (!organization) throw new Error('Meldungen gibt es nur für Feuerwehren.');
  return form;
}

export async function saveNotificationFormEnabled(organizationId: string, form: string, enabled: boolean): Promise<void> {
  const validForm = await assertConfigurable(organizationId, form);
  await prisma.notificationFormSetting.upsert({
    where: { organizationId_form: { organizationId, form: validForm } },
    create: { organizationId, form: validForm, enabled },
    update: { enabled },
  });
}

export async function saveNotificationFormRecipients(organizationId: string, form: string, recipients: string[]): Promise<void> {
  const validForm = await assertConfigurable(organizationId, form);
  const unique = [...new Set(recipients)];
  await prisma.notificationFormSetting.upsert({
    where: { organizationId_form: { organizationId, form: validForm } },
    create: { organizationId, form: validForm, recipients: unique },
    update: { recipients: unique },
  });
}

/** Produktliste des Getränkeautomaten (leer gespeichert = Standardprodukte). Ungültige Listen werden abgelehnt. */
export async function saveDrinkProducts(organizationId: string, products: unknown): Promise<void> {
  await assertConfigurable(organizationId, 'DRINKS');
  const parsed = parseDrinkProducts(products);
  if (!parsed.ok) throw new Error(parsed.error);
  await prisma.notificationFormSetting.upsert({
    where: { organizationId_form: { organizationId, form: 'DRINKS' } },
    create: { organizationId, form: 'DRINKS', products: parsed.value },
    update: { products: parsed.value },
  });
}
