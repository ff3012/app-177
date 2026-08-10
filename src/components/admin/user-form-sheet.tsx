'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import { AdminOrgMultiSelect } from '@/components/admin/admin-org-multiselect';
import { formatRelativeDate } from '@/lib/format';
import { DRONE_ROLE_OPTIONS, userSchema, type DroneRoleOption, type UserInput } from '@/lib/validation/user.schema';
import { createUser, updateUser, deleteUser, sendPasswordResetEmailToUser } from '@/app/(app)/admin/benutzer/actions';

const RESET_COOLDOWN_MS = 60_000;

interface OrganizationOption {
  id: string;
  name: string;
  abschnittName?: string;
}

/** Gruppiert Feuerwehren nach Abschnitt für das "Heimat-Feuerwehr"-Select unten - dieselbe
 * Begründung wie OrgSelect (admin/heimatfeuerwehr/org-select.tsx)/groupByAbschnitt
 * (admin/benutzer/user-management-section.tsx): mit bis zu 124 Feuerwehren (Bezirksadmin) ist eine
 * flache Liste ohne Gruppierung unbrauchbar. Nur gruppieren, wenn wenigstens ein Eintrag tatsächlich
 * einen abschnittName mitgibt - ein Feuerwehr-Admin mit 1-2 Optionen sieht weiterhin die schlichte
 * flache Liste.
 */
function groupOrganizationsByAbschnitt(organizations: OrganizationOption[]): Record<string, OrganizationOption[]> {
  const groups: Record<string, OrganizationOption[]> = {};
  for (const org of organizations) {
    const key = org.abschnittName ?? 'Ohne Abschnitt';
    (groups[key] ??= []).push(org);
  }
  return groups;
}

interface DienstgradOption {
  id: string;
  kurzform: string;
  bezeichnung: string;
}

export interface UserSheetTarget {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  stbNr: string;
  phone: string;
  isActive: boolean;
  istAtemschutzgeraeteTraeger: boolean;
  dienstgradId: string;
  homeOrganizationId: string;
  homeOrgName: string;
  adminOrgIds: string[];
  droneRole: DroneRoleOption;
  droneGroupId: string | null;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  isBezirksAdmin: boolean;
  isBezirksDrohnenAdmin: boolean;
}

interface UserFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  organizations: OrganizationOption[];
  dienstgrade: DienstgradOption[];
  droneGroups: { id: string; name: string }[];
  viewerIsBezirksAdmin: boolean;
  viewerIsBezirksDrohnenAdmin: boolean;
  target?: UserSheetTarget;
  onSaved: () => void;
}

const DRONE_ROLE_LABELS: Record<DroneRoleOption, string> = {
  NONE: 'Kein',
  PILOT: 'Mitglied',
  ADMIN: 'Admin',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-3 block text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">{children}</span>;
}

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[13px] font-medium text-ink">
      {children}
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-danger">{message}</p>;
}

function buildDefaultValues(
  target: UserSheetTarget | undefined,
  mode: 'create' | 'edit',
  organizations: OrganizationOption[],
): UserInput {
  return {
    firstName: target?.firstName ?? '',
    lastName: target?.lastName ?? '',
    email: target?.email ?? '',
    stbNr: target?.stbNr ?? '',
    phone: target?.phone ?? (mode === 'create' ? '+43' : ''),
    isActive: target ? target.isActive : mode === 'create' ? false : true,
    istAtemschutzgeraeteTraeger: target?.istAtemschutzgeraeteTraeger ?? false,
    dienstgradId: target?.dienstgradId ?? '',
    homeOrganizationId: target?.homeOrganizationId ?? organizations[0]?.id ?? '',
    adminOrgIds: target?.adminOrgIds ?? [],
    droneRole: target?.droneRole ?? 'NONE',
    droneGroupId: target?.droneGroupId ?? null,
    // Ausbildungsstufen: UserSheetTarget/das Formular selbst kennen diese Felder noch nicht (folgt in
    // einem späteren Task, der sie tatsächlich durch Server-Daten und UI-Eingaben ersetzt) - bis dahin
    // ist der leere String hier der einzige Wert, der `UserInput` erfüllt, ohne Daten zu erfinden.
    a1a3LizenzAm: '',
    a2LizenzAm: '',
    stuetzpunktausbildungAm: '',
    bos1AusbildungAm: '',
    bos2AusbildungAm: '',
    isBezirksAdmin: target?.isBezirksAdmin ?? false,
    isBezirksDrohnenAdmin: target?.isBezirksDrohnenAdmin ?? false,
    sendWelcomeEmail: true,
  };
}

/**
 * Benutzerverwaltung-Brief.md: Sheet-Geometrie in drei feste Bereiche + eine scrollende Mitte
 * (Kopf / "Zugang aktiv"-Leiste / scrollender Inhalt / klebender Fuß) - die Leiste liegt bewusst
 * AUSSERHALB des <form>-Elements (react-hook-form's handleSubmit liest trotzdem ihren Wert, da
 * beide denselben control-Kontext teilen, nicht die DOM-Verschachtelung unter <form>). Ersetzt
 * Verwaltung-Brief.md's ursprüngliche vier gleichrangigen Abschnitte durch die vom Brief
 * verlangte Feldpaarung (Person), den entfernten Passwort-Eingabe (ersetzt durch
 * Reset-Mail-Aktion), die Mehrfachauswahl "Admin für" und den neuen Block "Funktionen und
 * Ausbildung" (Atemschutz + segmentierte Drohnengruppen-Auswahl).
 */
export function UserFormSheet({
  open,
  onOpenChange,
  mode,
  organizations,
  dienstgrade,
  droneGroups,
  target,
  onSaved,
  viewerIsBezirksAdmin,
  viewerIsBezirksDrohnenAdmin,
}: UserFormSheetProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();
  const [activationLink, setActivationLink] = useState<string | undefined>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const resetCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<UserInput>({
    resolver: zodResolver(userSchema),
    mode: 'onBlur',
    defaultValues: buildDefaultValues(target, mode, organizations),
  });

  // UserFormSheet ist eine einzige, dauerhaft gemountete Instanz (anders als die frühere
  // UserForm-Seite, die bei jeder Bearbeitung frisch neu gemountet wurde) - react-hook-form liest
  // defaultValues aber nur einmal beim allerersten useForm()-Aufruf. Ohne dieses reset() beim
  // Öffnen bleiben die Feldwerte für immer auf dem Stand des ersten je geöffneten Benutzers eingefroren,
  // egal welche Zeile danach angeklickt wird (GitHub issue #7).
  useEffect(() => {
    if (!open) return;
    reset(buildDefaultValues(target, mode, organizations));
    setServerError(undefined);
    setActivationLink(undefined);
    setResetSent(false);
    if (resetCooldownRef.current) clearTimeout(resetCooldownRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.id, mode]);

  useEffect(() => {
    return () => {
      if (resetCooldownRef.current) clearTimeout(resetCooldownRef.current);
    };
  }, []);

  const sendWelcomeEmail = watch('sendWelcomeEmail');
  const isActive = watch('isActive');
  const email = watch('email');
  const droneRole = watch('droneRole');
  const isBezirksDrohnenAdmin = watch('isBezirksDrohnenAdmin');

  // Ein Bezirks-Drohnenadmin verwaltet per Definition alle Drohnengruppen bezirksweit - die
  // segmentierte Drohnengruppen-Auswahl unten wird auf "Admin" fixiert (siehe die gesperrten
  // Optionen dort), da userSchema's eigenes .refine() ohnehin verlangt, dass droneRole === 'ADMIN'
  // ist, sobald isBezirksDrohnenAdmin gesetzt ist - ohne dieses Erzwingen könnte die Validierung
  // fehlschlagen, obwohl der Schalter aus Sicht des Admins bereits "an" ist.
  useEffect(() => {
    if (isBezirksDrohnenAdmin) {
      setValue('droneRole', 'ADMIN', { shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBezirksDrohnenAdmin]);

  function requestClose(next: boolean) {
    if (!next && isDirty && !activationLink) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(next);
  }

  function onSubmit(values: UserInput) {
    const formData = new FormData();
    formData.set('firstName', values.firstName);
    formData.set('lastName', values.lastName);
    formData.set('email', values.email);
    formData.set('stbNr', values.stbNr ?? '');
    formData.set('phone', values.phone ?? '');
    if (values.isActive) formData.set('isActive', 'on');
    if (values.istAtemschutzgeraeteTraeger) formData.set('istAtemschutzgeraeteTraeger', 'on');
    formData.set('dienstgradId', values.dienstgradId ?? '');
    formData.set('homeOrganizationId', values.homeOrganizationId);
    for (const orgId of values.adminOrgIds) formData.append('adminOrgIds', orgId);
    formData.set('droneRole', values.droneRole);
    if (values.droneGroupId) formData.set('droneGroupId', values.droneGroupId);
    if (values.isBezirksAdmin) formData.set('isBezirksAdmin', 'on');
    if (values.isBezirksDrohnenAdmin) formData.set('isBezirksDrohnenAdmin', 'on');
    if (values.sendWelcomeEmail) formData.set('sendWelcomeEmail', 'on');

    startTransition(async () => {
      const action = mode === 'create' ? createUser : updateUser.bind(null, target!.id);
      const result = await action({}, formData);
      if (result?.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      if (result?.success && result?.activationLink) {
        setActivationLink(result.activationLink);
        return;
      }
      // Sonst: die Server Action hat bereits redirect('/admin/benutzer') geworfen - die Seite
      // rendert neu, Erfolg braucht hier keine weitere Behandlung.
      toast.success(mode === 'create' ? 'Benutzer angelegt.' : 'Änderungen gespeichert.');
      onSaved();
    });
  }

  async function handleSendReset() {
    if (!target) return;
    setResetPending(true);
    const result = await sendPasswordResetEmailToUser(target.id);
    setResetPending(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Reset-Mail an ${target.email} gesendet.`);
    // 60s "Gesendet"-Sperre gegen Mehrfachversand durch wiederholtes Klicken
    // (Benutzerverwaltung-Brief.md §3) - rein clientseitig, das serverseitige 3/Stunde-Limit
    // (sendPasswordResetEmailToUser) schützt unabhängig davon vor tatsächlichem Spam.
    setResetSent(true);
    resetCooldownRef.current = setTimeout(() => setResetSent(false), RESET_COOLDOWN_MS);
  }

  async function handleDelete() {
    if (!target) return;
    setDeletePending(true);
    const result = await deleteUser(target.id, {}, new FormData());
    setDeletePending(false);
    if (result?.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Benutzer wurde gelöscht.');
    onOpenChange(false);
    onSaved();
  }

  const resetDisabledReason = !isActive
    ? 'Zugang ist deaktiviert'
    : !email?.trim()
      ? 'Keine E-Mail-Adresse hinterlegt'
      : null;
  const resetDisabled = Boolean(resetDisabledReason) || resetPending || resetSent;

  const passwordChangedAt = target?.passwordChangedAt ? new Date(target.passwordChangedAt) : null;
  const passwordChanged = formatRelativeDate(passwordChangedAt, { fallback: 'Passwort noch nie gesetzt' });

  const lastLoginAt = target?.lastLoginAt ? new Date(target.lastLoginAt) : null;
  const lastLogin = formatRelativeDate(lastLoginAt, { fallback: 'noch nie angemeldet' });

  return (
    <>
      <Sheet open={open} onOpenChange={requestClose}>
        <SheetContent
          className="flex h-full flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none data-[side=right]:md:w-[520px] data-[side=right]:md:max-w-[520px]"
        >
          <SheetHeader className="flex-none border-b border-line px-5 py-4">
            <SheetTitle className="text-[22px] font-bold leading-tight text-ink">
              {mode === 'create' ? 'Neuer Benutzer' : `${target?.firstName} ${target?.lastName}`}
            </SheetTitle>
            {mode === 'edit' && target && (
              <p className="text-[14px] text-ink-muted" title={lastLogin.title}>
                {target.homeOrgName} · zuletzt angemeldet {lastLogin.label}
              </p>
            )}
          </SheetHeader>

          {mode === 'edit' && !activationLink && (
            <div className="flex flex-none items-center justify-between gap-3.5 border-b border-line bg-surface-sunken px-5 py-3.5">
              <div>
                <div className="text-[15px] font-semibold text-ink">Zugang aktiv</div>
                <div className="mt-0.5 text-[13px] text-ink-muted">Anmeldung und Benachrichtigungen erlaubt</div>
              </div>
              <Controller control={control} name="isActive" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
            </div>
          )}

          {activationLink ? (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              <p className="text-sm font-medium text-success-text">
                Benutzer wurde angelegt. Da keine Willkommen-E-Mail gesendet wurde, hier der Aktivierungslink
                zum manuellen Weitergeben:
              </p>
              <div className="flex items-start gap-2">
                <p className="flex-1 break-all rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-ink">
                  {activationLink}
                </p>
                <CopyLinkButton text={activationLink} />
              </div>
              <p className="text-xs text-ink-faint">Der Link ist 7 Tage gültig und einmalig verwendbar.</p>
              <div className="mt-2 flex items-center gap-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    reset();
                    setActivationLink(undefined);
                    onSaved();
                  }}
                >
                  Fertig
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setActivationLink(undefined);
                    setServerError(undefined);
                  }}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  Weiteren Benutzer anlegen
                </button>
              </div>
            </div>
          ) : (
            <>
              <form
                id="user-form-sheet"
                onSubmit={handleSubmit(onSubmit)}
                className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-5"
              >
                <section>
                  <SectionLabel>Person</SectionLabel>
                  <div className="flex flex-col gap-3.5">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <FieldLabel htmlFor="dienstgradId">Dienstgrad</FieldLabel>
                        <Controller
                          control={control}
                          name="dienstgradId"
                          render={({ field }) => (
                            <Select
                              value={field.value || 'NONE'}
                              onValueChange={(value) => field.onChange(value === 'NONE' ? '' : value)}
                            >
                              <SelectTrigger id="dienstgradId" className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NONE">–</SelectItem>
                                {dienstgrade.map((d) => (
                                  <SelectItem key={d.id} value={d.id}>
                                    {d.kurzform}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor="firstName">Vorname</FieldLabel>
                        <Input id="firstName" {...register('firstName')} />
                        <FieldError message={errors.firstName?.message} />
                      </div>
                      <div>
                        <FieldLabel htmlFor="lastName">Nachname</FieldLabel>
                        <Input id="lastName" {...register('lastName')} />
                        <FieldError message={errors.lastName?.message} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <FieldLabel htmlFor="phone">Telefonnummer</FieldLabel>
                        <Input id="phone" placeholder="+436601234567" {...register('phone')} />
                        <p className="mt-1 text-xs text-ink-faint">E.164-Format</p>
                        <FieldError message={errors.phone?.message} />
                      </div>
                      <div>
                        <FieldLabel htmlFor="stbNr">Standesbuchnummer</FieldLabel>
                        <Input id="stbNr" placeholder="optional" {...register('stbNr')} />
                        <FieldError message={errors.stbNr?.message} />
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <SectionLabel>Zugang</SectionLabel>
                  <div className="flex flex-col gap-4">
                    <div>
                      <FieldLabel htmlFor="email">E-Mail</FieldLabel>
                      <Input id="email" type="email" {...register('email')} />
                      <FieldError message={errors.email?.message} />
                    </div>

                    {mode === 'create' ? (
                      <div className="flex flex-col gap-2 rounded-lg bg-surface-sunken px-3 py-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] font-medium text-ink">Willkommen-E-Mail senden</span>
                          <Controller
                            control={control}
                            name="sendWelcomeEmail"
                            render={({ field }) => (
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            )}
                          />
                        </div>
                        <p className="text-xs text-ink-faint">
                          {sendWelcomeEmail
                            ? 'Der Benutzer erhält eine E-Mail mit einem Aktivierungslink und legt sein Passwort selbst fest.'
                            : 'Es wird keine E-Mail versendet. Der Aktivierungslink wird nach dem Anlegen angezeigt.'}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between gap-3.5">
                          <span className="text-[13px] font-medium text-ink">Passwort</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={resetDisabledReason ? 0 : -1} className="inline-block">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-[42px] px-4"
                                  disabled={resetDisabled}
                                  onClick={() => setConfirmReset(true)}
                                >
                                  {resetSent ? 'Gesendet' : resetPending ? 'Sende…' : 'Reset-Mail senden'}
                                </Button>
                              </span>
                            </TooltipTrigger>
                            {resetDisabledReason && <TooltipContent>{resetDisabledReason}</TooltipContent>}
                          </Tooltip>
                        </div>
                        <p className="mt-1.5 text-xs text-ink-faint" title={passwordChanged.title}>
                          Zuletzt geändert {passwordChanged.label} · Der Link ist 24 Stunden gültig.
                        </p>
                      </div>
                    )}
                  </div>
                </section>

                <section>
                  <SectionLabel>Zuordnung</SectionLabel>
                  <div className="flex flex-col gap-4">
                    <div>
                      <FieldLabel htmlFor="homeOrganizationId">Heimat-Feuerwehr</FieldLabel>
                      <Controller
                        control={control}
                        name="homeOrganizationId"
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id="homeOrganizationId" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {organizations.some((org) => Boolean(org.abschnittName))
                                ? Object.entries(groupOrganizationsByAbschnitt(organizations)).map(
                                    ([abschnittName, orgs]) => (
                                      <SelectGroup key={abschnittName}>
                                        <SelectLabel>{abschnittName}</SelectLabel>
                                        {orgs.map((org) => (
                                          <SelectItem key={org.id} value={org.id}>
                                            {org.name}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    ),
                                  )
                                : organizations.map((org) => (
                                    <SelectItem key={org.id} value={org.id}>
                                      {org.name}
                                    </SelectItem>
                                  ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                      <FieldError message={errors.homeOrganizationId?.message} />
                    </div>
                    <div>
                      <FieldLabel>Admin für</FieldLabel>
                      <Controller
                        control={control}
                        name="adminOrgIds"
                        render={({ field }) => (
                          <AdminOrgMultiSelect organizations={organizations} value={field.value} onChange={field.onChange} />
                        )}
                      />
                      <p className="mt-1 text-xs text-ink-faint">Leer lassen, wenn keine Adminrechte bestehen.</p>
                    </div>
                  </div>
                </section>

                {(viewerIsBezirksAdmin || viewerIsBezirksDrohnenAdmin) && (
                  <section>
                    <SectionLabel>Bezirksweite Rechte</SectionLabel>
                    <div className="rounded-lg border border-line">
                      <div className="flex items-center justify-between gap-3.5 px-3.5 py-3">
                        <div>
                          <div className="text-[15px] font-medium text-ink">Bezirksadmin</div>
                          <div className="mt-0.5 text-[13px] text-ink-muted">Voller Zugriff auf Benutzerverwaltung, E-Mail, Status, News</div>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={viewerIsBezirksAdmin ? -1 : 0} className="inline-block">
                              <Controller
                                control={control}
                                name="isBezirksAdmin"
                                render={({ field }) => (
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                    disabled={!viewerIsBezirksAdmin}
                                  />
                                )}
                              />
                            </span>
                          </TooltipTrigger>
                          {!viewerIsBezirksAdmin && <TooltipContent>Nur Bezirksadmins können diesen Status vergeben</TooltipContent>}
                        </Tooltip>
                      </div>
                    </div>
                  </section>
                )}

                <section>
                  <SectionLabel>Funktionen und Ausbildung</SectionLabel>
                  <div className="rounded-lg border border-line">
                    <div className="flex items-center justify-between gap-3.5 border-b border-line px-3.5 py-3">
                      <div>
                        <div className="text-[15px] font-medium text-ink">Atemschutzgeräteträger</div>
                        <div className="mt-0.5 text-[13px] text-ink-muted">Untersuchung und Finnentest werden geführt</div>
                      </div>
                      <Controller
                        control={control}
                        name="istAtemschutzgeraeteTraeger"
                        render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3.5 border-b border-line px-3.5 py-3">
                      <div className="text-[15px] font-medium text-ink">Drohnengruppe</div>
                      <Controller
                        control={control}
                        name="droneRole"
                        render={({ field }) => (
                          <SegmentedControl
                            aria-label="Drohnengruppe"
                            value={field.value}
                            onValueChange={field.onChange}
                            options={DRONE_ROLE_OPTIONS.map((option) => ({
                              value: option,
                              label: DRONE_ROLE_LABELS[option],
                              disabled: isBezirksDrohnenAdmin && option !== 'ADMIN',
                            }))}
                          />
                        )}
                      />
                    </div>
                    {(viewerIsBezirksAdmin || viewerIsBezirksDrohnenAdmin) && (
                      <div className="flex items-center justify-between gap-3.5 border-b border-line px-3.5 py-3">
                        <div>
                          <div className="text-[15px] font-medium text-ink">Bezirks Drohnenadmin</div>
                          <div className="mt-0.5 text-[13px] text-ink-muted">Verwaltet alle Drohnengruppen bezirksweit</div>
                        </div>
                        <Controller
                          control={control}
                          name="isBezirksDrohnenAdmin"
                          render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />}
                        />
                      </div>
                    )}
                    {droneRole !== 'NONE' && (
                      <div className="flex items-center justify-between gap-3.5 px-3.5 py-3">
                        <FieldLabel htmlFor="droneGroupId">Gruppe</FieldLabel>
                        <div className="flex-1">
                          <Controller
                            control={control}
                            name="droneGroupId"
                            render={({ field }) => (
                              <Select value={field.value || 'NONE'} onValueChange={(value) => field.onChange(value === 'NONE' ? null : value)}>
                                <SelectTrigger id="droneGroupId" className="w-full">
                                  <SelectValue placeholder="Gruppe wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="NONE" disabled>
                                    Gruppe wählen
                                  </SelectItem>
                                  {droneGroups.map((group) => (
                                    <SelectItem key={group.id} value={group.id}>
                                      {group.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                          <FieldError message={errors.droneGroupId?.message} />
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {serverError && <p className="text-sm text-danger">{serverError}</p>}
              </form>

              <SheetFooter className="flex-none flex-row items-center justify-between border-t border-line px-5 py-4">
                {mode === 'edit' ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="text-sm font-medium text-danger hover:underline"
                  >
                    Benutzer löschen
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2.5">
                  <Button type="button" variant="ghost" onClick={() => requestClose(false)}>
                    Abbrechen
                  </Button>
                  <Button type="submit" form="user-form-sheet" disabled={pending}>
                    {pending && (
                      <svg
                        viewBox="0 0 24 24"
                        width="14"
                        height="14"
                        fill="none"
                        className="animate-spin"
                        aria-hidden
                      >
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    )}
                    {pending ? 'Speichern…' : mode === 'create' ? 'Benutzer anlegen' : 'Änderungen speichern'}
                  </Button>
                </div>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Änderungen verwerfen?</AlertDialogTitle>
            <AlertDialogDescription>
              Du hast ungespeicherte Änderungen. Wenn du jetzt schließt, gehen sie verloren.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Weiter bearbeiten</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDiscard(false);
                onOpenChange(false);
              }}
            >
              Verwerfen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Passwort-Reset senden?</AlertDialogTitle>
            <AlertDialogDescription>
              Passwort-Reset an {target?.email} senden? Der Benutzer erhält einen Link, der 24 Stunden gültig ist.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmReset(false);
                handleSendReset();
              }}
            >
              Senden
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Benutzer endgültig löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Diese Aktion kann nicht rückgängig gemacht werden. Falls der Benutzer bereits Termine,
              Drohnenflüge oder News angelegt hat, schlägt das Löschen fehl - dann stattdessen deaktivieren.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction disabled={deletePending} onClick={handleDelete}>
              Endgültig löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
