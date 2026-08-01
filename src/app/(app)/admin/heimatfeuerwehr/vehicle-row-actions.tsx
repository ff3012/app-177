'use client';

import { useTransition } from 'react';
import Link from 'next/link';
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
import { VehicleFormDialog } from './vehicle-form-dialog';
import { deleteVehicle, toggleVehicleActive } from './actions';

interface VehicleTarget {
  id: string;
  taktischeBezeichnung: string;
  kennzeichen: string;
  marke: string;
  typ: string;
  isActive: boolean;
}

/** Ersetzt die früheren zwei separaten Inline-Buttons (Bearbeiten/Aktivieren-Deaktivieren) durch
 * ein DropdownMenu mit Bearbeiten/Aktivieren-Deaktivieren/Historie/Löschen - 1:1 das Muster von
 * user-row-actions.tsx in der Benutzerverwaltung. "Bearbeiten" reicht ein DropdownMenuItem (mit
 * onSelect={preventDefault}, damit das schließende Menü den Dialog-Trigger nicht stiehlt - dieselbe
 * Technik wie beim AlertDialogTrigger für "Löschen") als trigger-Prop an VehicleFormDialog durch,
 * statt dessen Bearbeiten-Formular hier zu duplizieren. */
export function VehicleRowActions({ vehicle }: { vehicle: VehicleTarget }) {
  const [pending, startTransition] = useTransition();

  function handleToggleActive() {
    startTransition(async () => {
      await toggleVehicleActive(vehicle.id);
      toast.success(vehicle.isActive ? 'Fahrzeug deaktiviert.' : 'Fahrzeug aktiviert.');
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteVehicle(vehicle.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Fahrzeug gelöscht.');
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
          <VehicleFormDialog
            mode="edit"
            target={vehicle}
            trigger={<DropdownMenuItem onSelect={(event) => event.preventDefault()}>Bearbeiten</DropdownMenuItem>}
          />
          <DropdownMenuItem disabled={pending} onSelect={handleToggleActive}>
            {vehicle.isActive ? 'Deaktivieren' : 'Aktivieren'}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/admin/heimatfeuerwehr/fahrzeug/${vehicle.id}`}>Historie</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <AlertDialogTrigger asChild>
            <DropdownMenuItem variant="destructive" onSelect={(event) => event.preventDefault()}>
              Löschen
            </DropdownMenuItem>
          </AlertDialogTrigger>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialogContent onClick={(event) => event.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Fahrzeug löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Diese Aktion kann nicht rückgängig gemacht werden. Falls das Fahrzeug bereits Buchungen hat (auch
            vergangene), schlägt das Löschen fehl - dann stattdessen deaktivieren.
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
