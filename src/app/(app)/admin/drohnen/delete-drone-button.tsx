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
import { deleteDrone } from './actions';

export function DeleteDroneButton({ droneId, droneName }: { droneId: string; droneName: string }) {
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteDrone(droneId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Drohne gelöscht.');
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
          <AlertDialogTitle>Drohne löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            „{droneName}" wird endgültig gelöscht. Diese Aktion kann nicht rückgängig gemacht werden. Falls für diese
            Drohne bereits Flüge erfasst sind (auch vergangene), schlägt das Löschen fehl – dann stattdessen
            deaktivieren.
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
