'use client';

import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
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
import { deleteChecklistAction } from '@/app/(app)/drohnen/checkliste/actions';

/**
 * Löscht einen nicht abgeschlossenen Entwurf ENDGÜLTIG (anders als "Verwerfen", das die Zeile in der
 * Drohnenverwaltung stehen lässt). Der Server prüft Rechte, Status und verknüpfte Flüge erneut und liefert
 * bei einer Ablehnung den Grund, der hier als Hinweis erscheint.
 */
export function DeleteDraftButton({
  checklistId,
  title,
  inFlight = false,
  variant = 'icon',
}: {
  checklistId: string;
  title: string;
  /** Der Flug läuft gerade (Schritt "Flug starten" gedrückt, "Flug beenden" noch nicht): deutlicher warnen. */
  inFlight?: boolean;
  /** `icon`: Papierkorb-Schaltfläche in der Entwurfsliste, `text`: Textlink in der Verwaltungsliste. */
  variant?: 'icon' | 'text';
}) {
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      try {
        const result = await deleteChecklistAction(checklistId);
        if (result.ok) toast.success('Entwurf gelöscht.');
        else toast.error(result.error);
      } catch {
        toast.error('Der Entwurf konnte nicht gelöscht werden.');
      }
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {variant === 'icon' ? (
          <button
            type="button"
            aria-label={`Entwurf ${title} löschen`}
            className="flex h-11 w-11 items-center justify-center rounded-md border border-line bg-surface text-ink-muted hover:bg-surface-sunken"
          >
            <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" aria-label={`Entwurf ${title} löschen`} className="font-semibold text-danger hover:underline">
            Löschen
          </button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Entwurf endgültig löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            „{title}“ wird dauerhaft gelöscht und lässt sich nicht wiederherstellen.
            {inFlight && ' Der Flug dazu läuft gerade - die Eingaben gehen verloren.'} Wenn der Entwurf nur nicht mehr gebraucht wird, aber in der
            Drohnenverwaltung sichtbar bleiben soll, verwirf ihn stattdessen.
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
