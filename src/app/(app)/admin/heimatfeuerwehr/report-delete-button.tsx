'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { deleteReport } from './actions';

/** Eigene, einfache AlertDialog-Variante (kein DropdownMenu wie bei VehicleRowActions) - die
 * Berichte-Tabelle hat pro Zeile nur diese eine Aktion. Löscht endgültig, inkl. des gespeicherten
 * PDFs (siehe deleteReport-Kommentar) - eine bewusst nicht rückgängig zu machende Aktion, daher der
 * Bestätigungsdialog statt eines bloßen "Löschen"-Links wie bei den Fahrzeug-Reservierungen oben auf
 * dieser Seite. */
export function ReportDeleteButton({ reportId, reportLabel }: { reportId: string; reportLabel: string }) {
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteReport(reportId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Bericht gelöscht.');
      }
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" className="text-sm text-danger hover:underline">
          Löschen
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Bericht löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            {reportLabel} wird endgültig gelöscht, inklusive des gespeicherten PDFs. Diese Aktion kann nicht
            rückgängig gemacht werden. Die bereits per E-Mail verschickte Kopie ist davon nicht betroffen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={handleDelete}>
            Endgültig löschen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
