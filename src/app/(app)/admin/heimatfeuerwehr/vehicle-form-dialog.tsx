'use client';

import { useState, useTransition } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createVehicle, updateVehicle, type VehicleFormState } from './actions';

interface VehicleTarget {
  id: string;
  taktischeBezeichnung: string;
  kennzeichen: string;
  marke: string;
  typ: string;
}

interface VehicleFormDialogProps {
  trigger: React.ReactNode;
  mode: 'create' | 'edit';
  organizationId?: string;
  target?: VehicleTarget;
}

/** Ein Dialog für Anlegen UND Bearbeiten eines Fahrzeugs (analog zum create/edit-Doppelmodus von
 * UserFormSheet, hier aber ein einfacher Dialog statt eines Sheets - nur 4 Felder). */
export function VehicleFormDialog({ trigger, mode, organizationId, target }: VehicleFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<VehicleFormState>({});

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const action = mode === 'create' ? createVehicle.bind(null, organizationId!) : updateVehicle.bind(null, target!.id);
      const result = await action({}, formData);
      if (result.error || result.fieldErrors) {
        setState(result);
        return;
      }
      setState({});
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setState({});
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Neues Fahrzeug' : 'Fahrzeug bearbeiten'}</DialogTitle>
        </DialogHeader>
        <form id="vehicle-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="taktischeBezeichnung" className="mb-1 block text-[13px] font-medium text-ink">
              Taktische Bezeichnung
            </label>
            <Input id="taktischeBezeichnung" name="taktischeBezeichnung" defaultValue={target?.taktischeBezeichnung} />
            {state.fieldErrors?.taktischeBezeichnung && (
              <p className="mt-1 text-xs text-danger">{state.fieldErrors.taktischeBezeichnung[0]}</p>
            )}
          </div>
          <div>
            <label htmlFor="kennzeichen" className="mb-1 block text-[13px] font-medium text-ink">
              Kennzeichen
            </label>
            <Input id="kennzeichen" name="kennzeichen" defaultValue={target?.kennzeichen} />
            {state.fieldErrors?.kennzeichen && <p className="mt-1 text-xs text-danger">{state.fieldErrors.kennzeichen[0]}</p>}
          </div>
          <div>
            <label htmlFor="marke" className="mb-1 block text-[13px] font-medium text-ink">
              Marke
            </label>
            <Input id="marke" name="marke" defaultValue={target?.marke} />
            {state.fieldErrors?.marke && <p className="mt-1 text-xs text-danger">{state.fieldErrors.marke[0]}</p>}
          </div>
          <div>
            <label htmlFor="typ" className="mb-1 block text-[13px] font-medium text-ink">
              Typ
            </label>
            <Input id="typ" name="typ" defaultValue={target?.typ} />
            {state.fieldErrors?.typ && <p className="mt-1 text-xs text-danger">{state.fieldErrors.typ[0]}</p>}
          </div>
          {state.error && <p className="text-sm text-danger">{state.error}</p>}
        </form>
        <DialogFooter>
          <Button type="submit" form="vehicle-form" disabled={pending}>
            {pending ? 'Speichern…' : 'Speichern'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
