'use client';

import { useState } from 'react';
import type { NotificationForm } from '@prisma/client';
import { countRequired, emptyValues, toInput, type NotificationValues } from '@/lib/heimatfeuerwehr/notification-form-fields';
import { DESCRIPTION_MAX, EQUIPMENT_MAX, NOTE_MAX, minOccurredOn, viennaToday, type NotificationInput } from '@/lib/heimatfeuerwehr/notification-input';

type SubmitResult = { ok?: true; error?: string };

function SectionCard({ number, title, tablet, children }: { number: string; title: string; tablet: boolean; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl bg-white shadow-sm ${tablet ? 'p-6' : 'p-4'}`}>
      <div className="mb-4 flex items-center gap-3 border-b border-neutral-100 pb-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">{number}</span>
        <h2 className="text-[17px] font-semibold text-[#1c1c1e]">{title}</h2>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="mb-1.5 block text-[13px] font-medium text-[#1c1c1e]">
      {children}
      {required && <span className="ml-1 text-red-600">*</span>}
    </span>
  );
}

/**
 * Meldeformular (Getränkeautomat / Schadensmeldung) für App (Handy-Layout) und Kiosk (Tablet-Layout). Sammelt nur die
 * Eingaben, der Server prüft alles (submitNotificationCore). "Meldung absenden" ist erst aktiv, wenn alle Pflichtfelder
 * ausgefüllt sind. Der Layoutwechsel ändert nur Klassen, nie die Elementstruktur (kein Neueinhängen beim Drehen).
 */
export function NotificationFormView({
  form,
  products,
  layout,
  onSubmit,
  onDone,
  onCancel,
}: {
  form: NotificationForm;
  products: string[];
  layout: 'mobile' | 'tablet';
  onSubmit: (input: NotificationInput) => Promise<SubmitResult>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const tablet = layout === 'tablet';
  const today = viennaToday();
  const dateMin = minOccurredOn(today);
  const [values, setValues] = useState<NotificationValues>(() => emptyValues(form, today));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { filled, total, complete } = countRequired(values);

  async function handleSubmit() {
    if (!complete || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit(toInput(values));
      if (result.error) {
        setError(result.error);
        setSubmitting(false);
        return;
      }
      onDone();
    } catch {
      setError('Die Meldung konnte nicht gesendet werden. Bitte erneut versuchen.');
      setSubmitting(false);
    }
  }

  const inputClass = `w-full rounded-lg border border-neutral-300 bg-white px-3 text-[#1c1c1e] ${tablet ? 'min-h-[52px] text-base' : 'min-h-[44px] text-sm'}`;
  const textareaClass = `w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[#1c1c1e] ${tablet ? 'text-base' : 'text-sm'}`;
  const chipBase = 'min-h-[48px] rounded-full border px-5 text-[15px] font-semibold';

  // Ein einziger Textknoten (keine React-Kommentarknoten zwischen den Zahlen), damit der Zähler testbar bleibt.
  const counter = <span className="text-sm text-neutral-500">{`${filled} / ${total} Pflichtfelder ausgefüllt`}</span>;
  const cancelButton = (
    <button type="button" onClick={onCancel} className="min-h-[52px] rounded-lg border border-neutral-300 bg-white px-6 text-[15px] font-semibold">
      Abbrechen
    </button>
  );
  const submitButton = (
    <button
      type="button"
      disabled={!complete || submitting}
      onClick={handleSubmit}
      className={`min-h-[52px] rounded-lg px-8 text-[15px] font-semibold text-white ${complete && !submitting ? 'bg-brand' : 'bg-neutral-300'}`}
    >
      {submitting ? 'Wird gesendet …' : 'Meldung absenden'}
    </button>
  );

  const errorMessage = error ? (
    <p role="alert" className="text-sm text-red-700">
      {error}
    </p>
  ) : null;

  return (
    <div data-layout={layout} className={`flex flex-col ${tablet ? 'gap-6' : 'gap-5 pb-48'}`}>
      {values.form === 'DRINKS' ? (
        <SectionCard number="01" title="Meldung" tablet={tablet}>
          <div>
            <FieldLabel required>Welche Produkte fehlen?</FieldLabel>
            <div className="flex flex-wrap gap-2.5">
              {products.map((product) => {
                const selected = values.form === 'DRINKS' && values.products.includes(product);
                return (
                  <button
                    key={product}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setValues((current) =>
                        current.form === 'DRINKS'
                          ? {
                              ...current,
                              products: current.products.includes(product)
                                ? current.products.filter((p) => p !== product)
                                : [...current.products, product],
                            }
                          : current,
                      )
                    }
                    className={`${chipBase} ${selected ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-[#1c1c1e]'}`}
                  >
                    {product}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="block">
            <FieldLabel>Anmerkung</FieldLabel>
            <textarea
              value={values.note}
              maxLength={NOTE_MAX}
              rows={tablet ? 5 : 4}
              onChange={(event) => setValues((current) => (current.form === 'DRINKS' ? { ...current, note: event.target.value } : current))}
              className={textareaClass}
            />
          </label>
        </SectionCard>
      ) : (
        <>
          <SectionCard number="01" title="Datum" tablet={tablet}>
            <label className="block">
              <FieldLabel required>Datum</FieldLabel>
              <input
                type="date"
                value={values.occurredOn}
                min={dateMin}
                max={today}
                onChange={(event) => setValues((current) => (current.form === 'DAMAGE' ? { ...current, occurredOn: event.target.value } : current))}
                className={inputClass}
              />
            </label>
          </SectionCard>
          <SectionCard number="02" title="Schaden" tablet={tablet}>
            <label className="block">
              <FieldLabel required>Betroffenes Gerät / Ausrüstung</FieldLabel>
              <input
                type="text"
                value={values.equipment}
                maxLength={EQUIPMENT_MAX}
                onChange={(event) => setValues((current) => (current.form === 'DAMAGE' ? { ...current, equipment: event.target.value } : current))}
                className={inputClass}
              />
            </label>
            <div>
              <FieldLabel>Ist der Schaden akut?</FieldLabel>
              <div className="grid grid-cols-2 gap-3">
                {([['Akut', true], ['Nicht akut', false]] as const).map(([label, value]) => {
                  const selected = values.form === 'DAMAGE' && values.acute === value;
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setValues((current) => (current.form === 'DAMAGE' ? { ...current, acute: current.acute === value ? null : value } : current))
                      }
                      className={`min-h-[52px] rounded-lg border text-[15px] font-semibold ${
                        selected ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-[#1c1c1e]'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="block">
              <FieldLabel required>Beschreibung des Schadens</FieldLabel>
              <textarea
                value={values.description}
                maxLength={DESCRIPTION_MAX}
                rows={tablet ? 6 : 5}
                onChange={(event) => setValues((current) => (current.form === 'DAMAGE' ? { ...current, description: event.target.value } : current))}
                className={textareaClass}
              />
            </label>
          </SectionCard>
        </>
      )}

      {tablet ? (
        <div
          className="sticky bottom-0 -mx-6 flex flex-col gap-2 border-t border-neutral-200 bg-white px-6 pt-3"
          style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}
        >
          {errorMessage}
          <div className="flex items-center justify-between gap-4">
            {cancelButton}
            {counter}
            {submitButton}
          </div>
        </div>
      ) : (
        <div className="pb-safe-tabbar fixed inset-x-0 bottom-[98px] z-40 flex flex-col gap-2 border-t border-neutral-200 bg-white p-4 sm:bottom-0">
          {errorMessage}
          <div className="text-center">{counter}</div>
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            {cancelButton}
            {submitButton}
          </div>
        </div>
      )}
    </div>
  );
}
