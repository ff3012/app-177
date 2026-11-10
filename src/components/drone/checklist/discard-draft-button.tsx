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
import { discardChecklistAction } from '@/app/(app)/drohnen/checkliste/actions';

/** Verwerfen löscht nichts: die Checkliste bleibt in der Drohnenverwaltung unter "Verworfen" sichtbar. */
export function DiscardDraftButton({ checklistId, title }: { checklistId: string; title: string }) {
  const [pending, startTransition] = useTransition();

  function handleDiscard() {
    startTransition(async () => {
      try {
        await discardChecklistAction(checklistId);
        toast.success('Entwurf verworfen.');
      } catch {
        toast.error('Der Entwurf konnte nicht verworfen werden.');
      }
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          aria-label={`Entwurf ${title} verwerfen`}
          className="flex h-11 w-11 items-center justify-center rounded-md border border-line bg-surface text-xl text-ink-muted hover:bg-surface-sunken"
        >
          ×
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Entwurf verwerfen?</AlertDialogTitle>
          <AlertDialogDescription>
            „{title}“ bleibt in der Drohnenverwaltung sichtbar, lässt sich aber nicht mehr fortsetzen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={handleDiscard}>
            Verwerfen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
