import type { NotificationForm } from '@prisma/client';
import type { NotificationInput } from './notification-input';

/** Reine Zustandslogik der Meldeformulare (keine Datenbank): auch für Client-Komponenten importierbar. */

export type NotificationValues =
  | { form: 'DRINKS'; products: string[]; note: string }
  | { form: 'DAMAGE'; occurredOn: string; equipment: string; acute: boolean | null; description: string };

/** Leerer Startzustand; die Schadensmeldung beginnt mit dem heutigen (Wiener) Datum. */
export function emptyValues(form: NotificationForm, today: string): NotificationValues {
  return form === 'DRINKS'
    ? { form: 'DRINKS', products: [], note: '' }
    : { form: 'DAMAGE', occurredOn: today, equipment: '', acute: null, description: '' };
}

/** Pflichtfelder: Getränkeautomat 1 (Produkte), Schadensmeldung 3 (Datum, Gerät/Ausrüstung, Beschreibung). */
export function countRequired(values: NotificationValues): { filled: number; total: number; complete: boolean } {
  const flags =
    values.form === 'DRINKS'
      ? [values.products.length > 0]
      : [values.occurredOn.trim().length > 0, values.equipment.trim().length > 0, values.description.trim().length > 0];
  const filled = flags.filter(Boolean).length;
  return { filled, total: flags.length, complete: filled === flags.length };
}

export function toInput(values: NotificationValues): NotificationInput {
  if (values.form === 'DRINKS') {
    const note = values.note.trim();
    return { form: 'DRINKS', products: values.products, note: note.length > 0 ? note : null };
  }
  return {
    form: 'DAMAGE',
    occurredOn: values.occurredOn,
    equipment: values.equipment,
    acute: values.acute,
    description: values.description,
  };
}
