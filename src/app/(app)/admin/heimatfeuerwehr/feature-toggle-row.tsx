'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
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
import { setOrganizationFeature } from './actions';

interface FeatureToggleRowProps {
  organizationId: string;
  feature: 'ATEMSCHUTZ' | 'FACEBOOK';
  title: string;
  description: string;
  enabled: boolean;
  disabled?: boolean;
  meta?: string;
  disabledHint?: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmNote: string;
}

/** Zeile in der "Funktionen"-Karte (Funktionsschalter-Brief.md §2) - sofortiges, optimistisches
 * Umschalten ohne Speichern-Button. Der Weg Ein→Aus zeigt vorher einen AlertDialog (Brief §3);
 * Aus→Ein schaltet sofort ohne Rückfrage. Bei einem Serverfehler (z. B. Facebook ohne Token bei einem
 * parallel eingetroffenen Request) schaltet der Switch optisch zurück und zeigt einen Toast. */
export function FeatureToggleRow({
  organizationId,
  feature,
  title,
  description,
  enabled,
  disabled = false,
  meta,
  disabledHint,
  confirmTitle,
  confirmDescription,
  confirmNote,
}: FeatureToggleRowProps) {
  const [optimisticEnabled, setOptimisticEnabled] = useState(enabled);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Resynchronisiert den optimistischen Zustand, wenn die zugrunde liegende Identität wechselt -
  // z. B. wenn ein Admin mehrerer Feuerwehren über OrgSelect die Organisation wechselt (page.tsx
  // rendert dann mit neuen Props, aber diese Komponente wird ohne key-Wechsel nicht neu gemountet)
  // oder wenn eine Server-Revalidierung nach der Änderung eines anderen Admins eintrifft. Gleiches
  // Prinzip wie UserFormSheet's reset()-in-useEffect-Fix (siehe CLAUDE.md).
  useEffect(() => {
    setOptimisticEnabled(enabled);
  }, [organizationId, feature, enabled]);

  function apply(next: boolean) {
    setOptimisticEnabled(next);
    startTransition(async () => {
      try {
        const result = await setOrganizationFeature(organizationId, feature, next);
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

  function handleConfirmOff() {
    setConfirmOpen(false);
    apply(false);
  }

  return (
    <div className="flex items-start justify-between gap-6 border-t border-line px-6 py-[18px] first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2.5">
          <span className="text-[16px] font-semibold text-ink">{title}</span>
          <Badge
            variant="outline"
            className={
              optimisticEnabled
                ? 'border-transparent bg-success-subtle text-success-text'
                : 'border-transparent bg-surface-sunken text-ink-muted'
            }
          >
            {optimisticEnabled ? 'Aktiv' : 'Aus'}
          </Badge>
        </div>
        <p className="text-sm text-ink-faint">{description}</p>
        {meta && <p className="mt-2 text-xs text-ink-faint">{meta}</p>}
        {disabled && disabledHint && (
          <div className="mt-2.5 flex items-start gap-2.5 rounded-lg bg-warning-subtle px-3 py-2.5">
            <span className="mt-1.5 h-[7px] w-[7px] flex-none rounded-full bg-warning" />
            <span className="text-[13px] text-warning-text">{disabledHint}</span>
          </div>
        )}
      </div>

      <Switch
        checked={optimisticEnabled}
        disabled={disabled || pending}
        onCheckedChange={handleCheckedChange}
        className="mt-1 flex-none"
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg bg-success-subtle px-4 py-3 text-sm text-success-text">{confirmNote}</div>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={handleConfirmOff}>
              Modul abschalten
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
