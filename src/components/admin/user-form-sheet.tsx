'use client';

import { useEffect, useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
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
import { DRONE_ROLE_OPTIONS, userSchema, type DroneRoleOption, type UserInput } from '@/lib/validation/user.schema';
import { createUser, updateUser } from '@/app/(app)/admin/benutzer/actions';

interface OrganizationOption {
  id: string;
  name: string;
}

export interface UserSheetTarget {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  stbNr: string;
  phone: string;
  isActive: boolean;
  homeOrganizationId: string;
  adminOrgIds: string[];
  droneRole: DroneRoleOption;
}

interface UserFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  organizations: OrganizationOption[];
  target?: UserSheetTarget;
  onSaved: () => void;
}

const DRONE_ROLE_LABELS: Record<DroneRoleOption, string> = {
  NONE: 'Kein Mitglied',
  PILOT: 'Mitglied',
  ADMIN: 'Admin Drohnengruppe',
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
    homeOrganizationId: target?.homeOrganizationId ?? organizations[0]?.id ?? '',
    adminOrgIds: target?.adminOrgIds ?? [],
    droneRole: target?.droneRole ?? 'NONE',
    password: '',
    sendWelcomeEmail: true,
  };
}

/**
 * Verwaltung-Brief.md 3.5: Anlegen/Bearbeiten als 520px-Sheet von rechts statt eigener Seiten
 * (neu/page.tsx und [userId]/page.tsx leiten jetzt nur noch hierher um). Vier einspaltige
 * Abschnitte (Person/Zugang/Zuordnung/Drohnengruppe) statt des bisherigen zweispaltigen Grids -
 * "die Feldlängen sind zu unterschiedlich" laut Brief. onOpenChange fängt einen Schließversuch bei
 * ungespeicherten Änderungen ab (formState.isDirty) und zeigt statt dessen einen AlertDialog, bevor
 * tatsächlich geschlossen wird - kein window.confirm().
 */
export function UserFormSheet({ open, onOpenChange, mode, organizations, target, onSaved }: UserFormSheetProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();
  const [activationLink, setActivationLink] = useState<string | undefined>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.id, mode]);

  const sendWelcomeEmail = watch('sendWelcomeEmail');
  const adminOrgIds = watch('adminOrgIds');

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
    formData.set('homeOrganizationId', values.homeOrganizationId);
    for (const orgId of values.adminOrgIds) formData.append('adminOrgIds', orgId);
    formData.set('droneRole', values.droneRole);
    if (values.password) formData.set('password', values.password);
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

  return (
    <>
      <Sheet open={open} onOpenChange={requestClose}>
        <SheetContent
          className="flex h-full flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none data-[side=right]:md:w-[520px] data-[side=right]:md:max-w-[520px]"
        >
          <SheetHeader className="border-b border-line px-5 py-4">
            <SheetTitle className="text-lg font-semibold text-ink">
              {mode === 'create' ? 'Neuer Benutzer' : `${target?.firstName} ${target?.lastName} bearbeiten`}
            </SheetTitle>
          </SheetHeader>

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
                className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-4"
              >
                <section>
                  <SectionLabel>Person</SectionLabel>
                  <div className="flex flex-col gap-4">
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
                    <div>
                      <FieldLabel htmlFor="stbNr">Standesbuchnummer</FieldLabel>
                      <Input id="stbNr" {...register('stbNr')} />
                      <FieldError message={errors.stbNr?.message} />
                    </div>
                    <div>
                      <FieldLabel htmlFor="phone">Telefonnummer</FieldLabel>
                      <Input id="phone" placeholder="+436601234567" {...register('phone')} />
                      <p className="mt-1 text-xs text-ink-faint">E.164-Format, z. B. +436601234567.</p>
                      <FieldError message={errors.phone?.message} />
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
                      <>
                        <div>
                          <FieldLabel htmlFor="password">Neues Passwort (optional)</FieldLabel>
                          <Input id="password" type="password" {...register('password')} />
                          <p className="mt-1 text-xs text-ink-faint">
                            Mindestens 8 Zeichen und 3 von 4: Kleinbuchstabe, Großbuchstabe, Ziffer, Sonderzeichen.
                          </p>
                          <FieldError message={errors.password?.message} />
                        </div>
                        <div className="flex items-center justify-between rounded-lg bg-surface-sunken px-3 py-2.5">
                          <span className="text-[13px] font-medium text-ink">Zugang aktiv</span>
                          <Controller
                            control={control}
                            name="isActive"
                            render={({ field }) => (
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            )}
                          />
                        </div>
                      </>
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
                              {organizations.map((org) => (
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
                          <div className="flex flex-col gap-1.5 rounded-lg border border-line p-3">
                            {organizations.map((org) => {
                              const checked = field.value.includes(org.id);
                              return (
                                <label key={org.id} className="flex min-h-6 items-center gap-2 text-sm text-ink">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(event) => {
                                      field.onChange(
                                        event.target.checked
                                          ? [...field.value, org.id]
                                          : field.value.filter((id) => id !== org.id),
                                      );
                                    }}
                                  />
                                  {org.name}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      />
                      {adminOrgIds.length === 0 && <p className="mt-1 text-xs text-ink-faint">–</p>}
                    </div>
                  </div>
                </section>

                <section>
                  <SectionLabel>Drohnengruppe</SectionLabel>
                  <Controller
                    control={control}
                    name="droneRole"
                    render={({ field }) => (
                      <RadioGroup value={field.value} onValueChange={field.onChange}>
                        {DRONE_ROLE_OPTIONS.map((option) => (
                          <label key={option} className="flex min-h-9 items-center gap-2 text-sm text-ink">
                            <RadioGroupItem value={option} />
                            {DRONE_ROLE_LABELS[option]}
                          </label>
                        ))}
                      </RadioGroup>
                    )}
                  />
                  <p className="mt-1 text-xs text-ink-faint">
                    Admin Drohnengruppe kann alle registrierten Flüge sehen, bearbeiten und löschen.
                  </p>
                </section>

                {serverError && <p className="text-sm text-danger">{serverError}</p>}
              </form>

              <SheetFooter className="flex-row justify-between border-t border-line px-5 py-4">
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
    </>
  );
}
