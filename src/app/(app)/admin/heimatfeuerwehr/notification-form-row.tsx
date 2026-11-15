'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
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
import { ReportRecipientsForm } from './report-recipients-form';
import { setNotificationFormEnabled, setNotificationFormRecipients } from './actions';

/**
 * Ein Meldeformular (Getränkeautomat/Schadensmeldung) im Abschnitt "Meldungen" der Karte "Berichte": Schalter
 * "Aktiviert" (gilt in der App und am iPad) und die Empfänger der Meldung. Einschalten geht sofort, Ausschalten fragt per
 * Dialog nach (Muster wie ReportTypeRow); bei einem Serverfehler schaltet der Schalter zurück und zeigt einen Hinweis.
 * `children` nimmt formularspezifische Zusatzeinstellungen auf (Produktliste beim Getränkeautomat).
 */
export function NotificationFormRow({
  organizationId,
  form,
  title,
  enabled,
  recipients,
  members,
  children,
}: {
  organizationId: string;
  form: string;
  title: string;
  enabled: boolean;
  recipients: string[];
  members: { id: string; firstName: string; lastName: string; email: string }[];
  children?: React.ReactNode;
}) {
  const [optimisticEnabled, setOptimisticEnabled] = useState(enabled);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setOptimisticEnabled(enabled);
  }, [organizationId, form, enabled]);

  function apply(next: boolean) {
    setOptimisticEnabled(next);
    startTransition(async () => {
      try {
        const result = await setNotificationFormEnabled(organizationId, form, next);
        if (result.error) {
          setOptimisticEnabled(!next);
          toast.error(result.error);
        }
      } catch {
        setOptimisticEnabled(!next);
        toast.error('Änderung konnte nicht gespeichert werden.');
      }
    });
  }

  function handleCheckedChange(next: boolean) {
    if (!next) {
      setConfirmOpen(true);
      return;
    }
    apply(true);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        <label className="flex items-center gap-2 text-sm text-ink">
          Aktiviert
          <Switch checked={optimisticEnabled} disabled={pending} onCheckedChange={handleCheckedChange} aria-label={`${title} aktiviert`} />
        </label>
      </div>
      <p className="text-xs text-ink-faint">
        Diese Adressen erhalten die Meldung per E-Mail. Ohne mindestens eine Adresse ist das Formular nicht verfügbar.
      </p>
      <ReportRecipientsForm
        action={setNotificationFormRecipients.bind(null, organizationId, form)}
        idSuffix={`meldung-${form}`}
        initialEmails={recipients}
        members={members}
      />
      {children}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title} ausschalten?</AlertDialogTitle>
            <AlertDialogDescription>
              Das Formular „{title}“ verschwindet danach am iPad und in der App dieser Feuerwehr. Empfänger und Produkte bleiben
              unverändert erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                apply(false);
              }}
            >
              Ausschalten
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
