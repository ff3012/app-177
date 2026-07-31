'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { deleteUser, sendPasswordResetEmailToUser, setUserActive } from './actions';

interface UserRowActionsProps {
  userId: string;
  isActive: boolean;
  isSelf: boolean;
  onEdit: () => void;
}

/** Zeilenmenü (Verwaltung-Brief.md 3.3) - ersetzt das bisherige einzelne Stiftsymbol.
 * "Bearbeiten" öffnet jetzt das UserFormSheet (Phase 4) statt zur alten [userId]-Seite zu
 * navigieren - die alten delete-user-button.tsx/password-reset-email-button.tsx wurden komplett
 * durch dieses Menü ersetzt, nicht nur ergänzt. "Aktivieren/Deaktivieren" ruft den neuen dünnen
 * setUserActive-Wrapper (actions.ts), "Löschen" wiederverwendet die bestehende deleteUser-Action
 * unverändert, nur hinter einem AlertDialog statt der alten eigenen Bestätigungs-Textzeile. */
export function UserRowActions({ userId, isActive, isSelf, onEdit }: UserRowActionsProps) {
  const [pending, startTransition] = useTransition();

  function handleToggleActive() {
    startTransition(async () => {
      const result = await setUserActive(userId, !isActive);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(isActive ? 'Benutzer deaktiviert.' : 'Benutzer aktiviert.');
      }
    });
  }

  function handlePasswordReset() {
    startTransition(async () => {
      const result = await sendPasswordResetEmailToUser(userId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Passwort-Reset-E-Mail wurde gesendet.');
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteUser(userId, {}, new FormData());
      if (result?.error) {
        toast.error(result.error);
      }
    });
  }

  return (
    <AlertDialog>
      <DropdownMenu>
        <DropdownMenuTrigger
          onClick={(event) => event.stopPropagation()}
          aria-label="Aktionen"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-sunken"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="5" r="1.2" />
            <circle cx="12" cy="12" r="1.2" />
            <circle cx="12" cy="19" r="1.2" />
          </svg>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
          <DropdownMenuItem onSelect={onEdit}>Bearbeiten</DropdownMenuItem>
          <DropdownMenuItem disabled={pending} onSelect={handlePasswordReset}>
            Passwort zurücksetzen
          </DropdownMenuItem>
          <DropdownMenuItem disabled={pending} onSelect={handleToggleActive}>
            {isActive ? 'Deaktivieren' : 'Aktivieren'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <AlertDialogTrigger asChild>
            <DropdownMenuItem
              disabled={isSelf}
              variant="destructive"
              onSelect={(event) => event.preventDefault()}
            >
              Löschen
            </DropdownMenuItem>
          </AlertDialogTrigger>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialogContent onClick={(event) => event.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Benutzer endgültig löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Diese Aktion kann nicht rückgängig gemacht werden. Falls der Benutzer bereits Termine, Drohnenflüge
            oder News angelegt hat, schlägt das Löschen fehl - dann stattdessen deaktivieren.
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
