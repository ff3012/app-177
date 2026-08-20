'use client';

import { useActionState, useEffect, useState } from 'react';
import { setFlightNotificationEmails, type DroneGroupEmailState } from './actions';

const initialState: DroneGroupEmailState = {};

/** Ersetzte ursprünglich die frühere singleton-weite "Drohnenflug E-Mail" auf /admin/email als
 * einzelnes E-Mail-Feld; auf ausdrücklichen Wunsch auf dieselbe Chip-Liste + People-Picker umgebaut
 * wie PhotoUploadNotificationEmailsForm/FahrzeugReservierungEmailForm (admin/heimatfeuerwehr) - der
 * Picker lädt hier ausschließlich Mitglieder DIESER Drohnengruppe (siehe page.tsx-Query), nicht
 * Mitglieder einer Heimatfeuerwehr. Leer lassen = keine Benachrichtigung für diese Gruppe. */
export function DroneGroupEmailForm({
  droneGroupId,
  initialEmails,
  members,
}: {
  droneGroupId: string;
  initialEmails: string[];
  members: { id: string; firstName: string; lastName: string; email: string }[];
}) {
  const boundAction = setFlightNotificationEmails.bind(null, droneGroupId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const [emails, setEmails] = useState<string[]>(initialEmails);
  const [newEmail, setNewEmail] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (state.success) setDirty(false);
  }, [state]);

  const saved = state.success && !dirty;

  function addEmail(email: string) {
    const trimmed = email.trim();
    if (!trimmed || emails.includes(trimmed)) return;
    setEmails((prev) => [...prev, trimmed]);
    setDirty(true);
  }

  function removeEmail(email: string) {
    setEmails((prev) => prev.filter((e) => e !== email));
    setDirty(true);
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg bg-surface-sunken p-3">
      <input type="hidden" name="emails" value={JSON.stringify(emails)} />

      {emails.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {emails.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-3 py-1 text-sm text-ink"
            >
              {email}
              <button
                type="button"
                onClick={() => removeEmail(email)}
                aria-label={`${email} entfernen`}
                className="text-ink-muted hover:text-danger"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="newFlightNotificationEmail" className="text-sm font-medium text-ink">
            E-Mail-Adresse hinzufügen
          </label>
          <div className="flex gap-2">
            <input
              id="newFlightNotificationEmail"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="z. B. drohnen@abschnitt-purkersdorf.at"
              className="flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
            />
            <button
              type="button"
              onClick={() => {
                addEmail(newEmail);
                setNewEmail('');
              }}
              className="rounded-md bg-neutral-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-600"
            >
              Hinzufügen
            </button>
          </div>
        </div>

        {members.length > 0 && (
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="flightNotificationMemberPicker" className="text-sm font-medium text-ink">
              Aus Mitgliedern wählen
            </label>
            <select
              id="flightNotificationMemberPicker"
              value=""
              onChange={(e) => {
                if (e.target.value) addEmail(e.target.value);
                e.target.value = '';
              }}
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
            >
              <option value="">Mitglied auswählen…</option>
              {members.map((member) => (
                <option key={member.id} value={member.email}>
                  {member.lastName} {member.firstName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <p className="text-xs text-ink-faint">
        An diese Adressen wird bei jeder Registrierung eines neuen Drohnenflugs dieser Gruppe eine
        Benachrichtigung gesendet. Leer lassen für keine Benachrichtigung.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${
            saved ? 'bg-success hover:opacity-90' : 'bg-brand hover:bg-brand-hover'
          }`}
        >
          {pending ? 'Speichern…' : saved ? 'Gespeichert' : 'Speichern'}
        </button>
        {state.error && <p className="text-xs text-danger">{state.error}</p>}
      </div>
    </form>
  );
}
