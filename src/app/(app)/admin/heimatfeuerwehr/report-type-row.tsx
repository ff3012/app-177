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
import { setReportTypeEnabled } from './actions';

/**
 * Eine Berichtsart in der Karte "Berichte": Schalter "Aktiviert" (gilt in der App und am iPad) und die
 * Empfänger des Berichts. Einschalten geht sofort ohne Rückfrage, Ausschalten fragt per Dialog nach (Muster wie
 * FeatureToggleRow); bei einem Serverfehler schaltet der Schalter zurück und zeigt einen Hinweis.
 */
export function ReportTypeRow({
  organizationId,
  type,
  title,
  enabled,
  recipients,
  members,
}: {
  organizationId: string;
  type: string;
  title: string;
  enabled: boolean;
  recipients: string[];
  members: { id: string; firstName: string; lastName: string; email: string }[];
}) {
  const [optimisticEnabled, setOptimisticEnabled] = useState(enabled);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setOptimisticEnabled(enabled);
  }, [organizationId, type, enabled]);

  function apply(next: boolean) {
    setOptimisticEnabled(next);
    startTransition(async () => {
      try {
        const result = await setReportTypeEnabled(organizationId, type, next);
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
      <p className="text-xs text-ink-faint">Diese Adressen erhalten eine E-Mail mit PDF-Anhang, sobald ein {title} abgegeben wird.</p>
      <ReportRecipientsForm organizationId={organizationId} type={type} initialEmails={recipients} members={members} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title} ausschalten?</AlertDialogTitle>
            <AlertDialogDescription>
              Der {title} verschwindet danach in der App und am iPad dieser Feuerwehr. Bereits abgegebene Berichte und die
              Empfänger bleiben unverändert erhalten.
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
