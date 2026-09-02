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
import { deleteDroneGroup } from './actions';

/** Nur für bereits deaktivierte Gruppen gerendert (siehe page.tsx) - Deaktivieren ist der erste,
 * jederzeit rückgängig machbare Schritt, Löschen der zweite, endgültige. Blockiert serverseitig
 * (deleteDroneGroup), solange die Gruppe noch Drohnen/Mitglieder/Dokumente/Termine/News-Beiträge
 * hat - dieselbe "erst zählen, dann blockieren" AlertDialog-Struktur wie VehicleRowActions'
 * Fahrzeug-Löschen (admin/heimatfeuerwehr). */
export function DeleteDroneGroupButton({ droneGroupId, name }: { droneGroupId: string; name: string }) {
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteDroneGroup(droneGroupId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Drohnengruppe gelöscht.');
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
          <AlertDialogTitle>„{name}" löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Diese Aktion kann nicht rückgängig gemacht werden. Solange die Gruppe noch Drohnen, Mitglieder,
            Dokumente, Termine oder News-Beiträge hat, schlägt das Löschen fehl.
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
