'use client';

import { useEffect, useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { EVENT_CATEGORIES, eventSchema, type EventInput } from '@/lib/validation/event.schema';
import { DateTime15MinInput } from '@/components/ui/datetime-15min-input';
import { getRememberedValues, rememberValue } from '@/lib/remembered-values';
import type { EventFormState } from '@/app/(app)/kalender/actions';

// Merkt bis zu 8 zuletzt verwendete, unterschiedliche Termin-Orte - eigener, vom Drohnenflug-
// Formular getrennter Verlauf (siehe docs/superpowers/specs/2026-08-28-
// formular-vorschlaege-design.md).
const KALENDER_EVENT_LOCATION_KEY = 'app177-kalender-event-locations';

interface OrganizationOption {
  id: string;
  name: string;
  type: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO';
  isActive?: boolean;
}

interface DroneGroupOption {
  id: string;
  name: string;
}

interface EventFormProps {
  organizations: OrganizationOption[];
  canSectionWide: boolean;
  droneGroupOptions: DroneGroupOption[];
  defaultValues?: Partial<EventInput>;
  action: (prevState: EventFormState, formData: FormData) => Promise<EventFormState>;
  submitLabel: string;
}

export function EventForm({
  organizations,
  canSectionWide,
  droneGroupOptions,
  defaultValues,
  action,
  submitLabel,
}: EventFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();
  const [locations, setLocations] = useState<string[]>([]);

  useEffect(() => {
    setLocations(getRememberedValues(KALENDER_EVENT_LOCATION_KEY));
  }, []);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<EventInput>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      title: '',
      description: '',
      location: '',
      startsAt: '',
      endsAt: '',
      allDay: false,
      organizationId: organizations[0]?.id ?? '',
      isSectionWide: false,
      // Ein Nutzer ohne jede eigene Feuerwehr-Admin-Mitgliedschaft (reiner Bezirksadmin/Bezirks-
      // Drohnenadmin/Admin Drohnengruppe) hat organizations=[] - für den ist "Allgemein" gar keine
      // sinnvolle Standardauswahl (leeres Organisation-<select>), "Drohnengruppe" dagegen schon.
      category: organizations.length === 0 && droneGroupOptions.length > 0 ? 'DROHNENGRUPPE' : 'ALLGEMEIN',
      droneGroupId: droneGroupOptions[0]?.id ?? null,
      ...defaultValues,
    },
  });

  const selectedOrgId = watch('organizationId');
  const selectedOrg = organizations.find((org) => org.id === selectedOrgId);
  const showSectionWideOption = canSectionWide && selectedOrg?.type === 'ABSCHNITTSKOMMANDO';
  const category = watch('category');
  const startsAt = watch('startsAt');

  // "Drohnengruppe" nur als Kategorie-Option anbieten, wenn es überhaupt eine wählbare Gruppe gibt
  // (droneGroupOptions kommt bereits vorgefiltert vom Aufrufer - alle Gruppen, die dieser Nutzer
  // verwalten darf, plus ggf. der bezirksweite Sentinel-Eintrag) - sonst entstünde ein Termin ohne
  // droneGroupId, der für niemanden sichtbar wäre. Bearbeitet man einen bereits als Drohnengruppen-
  // Termin angelegten Eintrag, bleibt die Option erhalten, damit der aktuelle Wert im Select nicht
  // verlorengeht.
  const categoryOptions = EVENT_CATEGORIES.filter(
    (categoryOption) =>
      categoryOption !== 'DROHNENGRUPPE' ||
      droneGroupOptions.length > 0 ||
      defaultValues?.category === 'DROHNENGRUPPE',
  );
  // Der Kategorie-Umschalter selbst ist unabhängig von showSectionWideOption sichtbar (früher war er
  // daran gekoppelt, weil ein Drohnengruppen-Termin nur über eine als Organisation gewählte
  // Abschnittskommando-Organisation erreichbar war - das gilt nicht mehr, Drohnengruppe ist jetzt
  // eine eigenständige Kategorie unabhängig von der Organisation-Auswahl). categoryOptions.length > 1
  // heißt genau "DROHNENGRUPPE ist tatsächlich eine echte Option", da ALLGEMEIN nie herausgefiltert wird.
  // Zusätzlich organizations.length > 0: ein Nutzer ohne jede eigene Feuerwehr-Admin-Mitgliedschaft
  // (reiner Bezirksadmin/Bezirks-Drohnenadmin/Admin Drohnengruppe) darf zwar Drohnengruppen-Termine
  // anlegen, aber "Allgemein" wäre für ihn eine Sackgasse - das Organisation-<select> unten wäre leer
  // und ein Submit würde an der organizationId-Pflichtfeld-Validierung scheitern. Der Kategorie-Select
  // wird für ihn deshalb gar nicht erst angeboten; category bleibt fest auf 'DROHNENGRUPPE' (siehe der
  // Default oben, der genau diesen Fall bereits erkennt).
  const showCategorySelect = categoryOptions.length > 1 && organizations.length > 0;
  const isDroneCategory = category === 'DROHNENGRUPPE';

  // Ende übernimmt bei jeder Änderung von Start automatisch dessen Datum. Solange Ende noch gar
  // keine eigene Uhrzeit hat, wird zusätzlich Start + 15 Minuten als Uhrzeit vorgeschlagen; hat
  // Ende bereits eine (manuell oder zuvor automatisch gesetzte) Uhrzeit, bleibt nur das Datum synchron.
  useEffect(() => {
    if (!startsAt) return;
    const [startDate, startTime] = startsAt.split('T');
    if (!startDate || !startTime) return;

    const currentEnd = getValues('endsAt');
    const currentEndTime = currentEnd && currentEnd.includes('T') ? currentEnd.split('T')[1] : '';

    if (currentEndTime) {
      const newEnd = `${startDate}T${currentEndTime}`;
      if (newEnd !== currentEnd) setValue('endsAt', newEnd);
      return;
    }

    const suggestedEnd = new Date(`${startDate}T${startTime}`);
    suggestedEnd.setMinutes(suggestedEnd.getMinutes() + 15);
    const pad = (n: number) => String(n).padStart(2, '0');
    const newEnd = `${suggestedEnd.getFullYear()}-${pad(suggestedEnd.getMonth() + 1)}-${pad(suggestedEnd.getDate())}T${pad(suggestedEnd.getHours())}:${pad(suggestedEnd.getMinutes())}`;
    setValue('endsAt', newEnd);
  }, [startsAt, getValues, setValue]);

  function onSubmit(values: EventInput) {
    const formData = new FormData();
    formData.set('title', values.title);
    formData.set('description', values.description ?? '');
    formData.set('location', values.location ?? '');
    formData.set('startsAt', values.startsAt);
    formData.set('endsAt', values.endsAt);
    if (values.allDay) formData.set('allDay', 'on');
    formData.set('organizationId', values.organizationId);
    if (values.isSectionWide) formData.set('isSectionWide', 'on');
    formData.set('category', values.category);
    if (values.droneGroupId) formData.set('droneGroupId', values.droneGroupId);

    startTransition(async () => {
      const result = await action({}, formData);
      setServerError(result?.error);
      if (!result?.error && values.location) rememberValue(KALENDER_EVENT_LOCATION_KEY, values.location, 8);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Titel</label>
        <input {...register('title')} className="rounded border border-neutral-300 px-3 py-2" />
        {errors.title && <p className="text-sm text-red-700">{errors.title.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Beschreibung</label>
        <textarea {...register('description')} rows={3} className="rounded border border-neutral-300 px-3 py-2" />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Ort</label>
        <input
          {...register('location')}
          list="kalender-event-location-suggestions"
          className="rounded border border-neutral-300 px-3 py-2"
        />
        <datalist id="kalender-event-location-suggestions">
          {locations.map((location) => (
            <option key={location} value={location} />
          ))}
        </datalist>
        {/* Eigene Chip-Liste zusätzlich zum <datalist> oben: Android-WebView zeigt native
            <datalist>-Vorschläge oft gar nicht an (bestätigte Einschränkung, siehe
            docs/superpowers/specs/2026-08-28-formular-vorschlaege-design.md) - diese Buttons
            funktionieren unabhängig davon, da sie reines React sind. */}
        {locations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {locations.map((location) => (
              <button
                key={location}
                type="button"
                onClick={() => setValue('location', location, { shouldValidate: true })}
                className="rounded-full border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
              >
                {location}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Start</label>
          <Controller
            control={control}
            name="startsAt"
            render={({ field }) => <DateTime15MinInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
          />
          {errors.startsAt && <p className="text-sm text-red-700">{errors.startsAt.message}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Ende</label>
          <Controller
            control={control}
            name="endsAt"
            render={({ field }) => <DateTime15MinInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
          />
          {errors.endsAt && <p className="text-sm text-red-700">{errors.endsAt.message}</p>}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" {...register('allDay')} />
        Ganztägig
      </label>

      {!isDroneCategory && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Organisation</label>
          <select {...register('organizationId')} className="rounded border border-neutral-300 px-3 py-2">
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.isActive === false ? `${org.name} (deaktiviert)` : org.name}
              </option>
            ))}
          </select>
          {errors.organizationId && <p className="text-sm text-red-700">{errors.organizationId.message}</p>}
        </div>
      )}

      {showSectionWideOption && !isDroneCategory && (
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" {...register('isSectionWide')} />
          Abschnitt-weiter Termin (in allen Feuerwehr-Kalendern sichtbar)
        </label>
      )}

      {showCategorySelect && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Kategorie</label>
          <select {...register('category')} className="rounded border border-neutral-300 px-3 py-2">
            {categoryOptions.map((categoryOption) => (
              <option key={categoryOption} value={categoryOption}>
                {categoryOption === 'DROHNENGRUPPE' ? 'Drohnengruppe' : 'Allgemein'}
              </option>
            ))}
          </select>
          <p className="text-xs text-neutral-500">
            Kategorie "Drohnengruppe" ist nur für Mitglieder der Drohnengruppe sichtbar.
          </p>
        </div>
      )}

      {isDroneCategory && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Drohnengruppe</label>
          <select {...register('droneGroupId')} className="rounded border border-neutral-300 px-3 py-2">
            {droneGroupOptions.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {serverError && <p className="text-sm text-red-700">{serverError}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? 'Speichern…' : submitLabel}
        </button>
        <Link href="/kalender" className="text-sm text-neutral-600 hover:underline">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
