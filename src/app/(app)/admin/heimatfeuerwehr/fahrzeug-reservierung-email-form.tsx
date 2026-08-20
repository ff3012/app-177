'use client';

import { useActionState, useEffect, useState } from 'react';
import { setFahrzeugReservierungEmails, type FahrzeugReservierungEmailsState } from './actions';

const initialState: FahrzeugReservierungEmailsState = {};

/** War ursprünglich ein einzelnes E-Mail-Feld; auf ausdrücklichen Wunsch auf dieselbe Chip-Liste +
 * People-Picker umgebaut wie PhotoUploadNotificationEmailsForm (siehe dort für die Begründung, warum
 * das ein Handbau-Multi-Select statt AdminOrgMultiSelect ist). Der Picker lädt ausschließlich
 * Mitglieder DIESER Feuerwehr (siehe page.tsx-Query, von der Foto-Upload-Karte wiederverwendet) -
 * das setzt "nur Mitglieder aus der Heimatfeuerwehr" um. */
export function FahrzeugReservierungEmailForm({
  organizationId,
  initialEmails,
  members,
}: {
  organizationId: string;
  initialEmails: string[];
  members: { id: string; firstName: string; lastName: string; email: string }[];
}) {
  const boundAction = setFahrzeugReservierungEmails.bind(null, organizationId);
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
    <form action={formAction} className="mb-4 flex flex-col gap-3 rounded-lg bg-surface-sunken p-3">
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
          <label htmlFor="newFahrzeugReservierungEmail" className="text-[13px] font-medium text-ink">
            E-Mail-Adresse hinzufügen
          </label>
          <div className="flex gap-2">
            <input
              id="newFahrzeugReservierungEmail"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="z. B. kommando@ff-wolfsgraben.at"
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
            <label htmlFor="fahrzeugReservierungMemberPicker" className="text-[13px] font-medium text-ink">
              Aus Mitgliedern wählen
            </label>
            <select
              id="fahrzeugReservierungMemberPicker"
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
