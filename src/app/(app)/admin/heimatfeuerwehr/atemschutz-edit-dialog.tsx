'use client';

import { useRef, useState, useTransition } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { updateAtemschutzStatus, type AtemschutzFormState } from './actions';

interface AtemschutzTarget {
  userId: string;
  name: string;
  istAtemschutzgeraeteTraeger: boolean;
  atemschutzUntersuchungAm: string; // "YYYY-MM-DD" oder ""
  atemschutzGueltigBis: string;
  atemschutzFinnentestAm: string;
}

function addYears(dateStr: string, years: number): string {
  const date = new Date(dateStr);
  date.setFullYear(date.getFullYear() + years);
  return date.toISOString().slice(0, 10);
}

/** Bearbeitet den Atemschutz-Status eines Mitglieds. "Gültig bis" schlägt beim Ändern von
 * "Untersuchung am" +5 Jahre vor, überschreibt aber einen bereits manuell gesetzten Wert nicht
 * mehr - dasselbe Start→Ende-Auto-Vorschlag-Muster wie in components/calendar/event-form.tsx. */
export function AtemschutzEditDialog({ trigger, target }: { trigger: React.ReactNode; target: AtemschutzTarget }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<AtemschutzFormState>({});

  const [traeger, setTraeger] = useState(target.istAtemschutzgeraeteTraeger);
  const [untersuchungAm, setUntersuchungAm] = useState(target.atemschutzUntersuchungAm);
  const [gueltigBis, setGueltigBis] = useState(target.atemschutzGueltigBis);
  const [finnentestAm, setFinnentestAm] = useState(target.atemschutzFinnentestAm);
  const gueltigBisTouchedRef = useRef(Boolean(target.atemschutzGueltigBis));

  function handleUntersuchungChange(value: string) {
    setUntersuchungAm(value);
    if (!gueltigBisTouchedRef.current && value) {
      setGueltigBis(addYears(value, 5));
    }
  }

  function handleGueltigBisChange(value: string) {
    gueltigBisTouchedRef.current = true;
    setGueltigBis(value);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    if (traeger) formData.set('istAtemschutzgeraeteTraeger', 'on');

    startTransition(async () => {
      const result = await updateAtemschutzStatus(target.userId, {}, formData);
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
          <DialogTitle>Atemschutz: {target.name}</DialogTitle>
        </DialogHeader>
        <form id={`atemschutz-form-${target.userId}`} onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-lg bg-surface-sunken px-3 py-2.5">
            <span className="text-[13px] font-medium text-ink">Atemschutzgeräteträger</span>
            <Switch checked={traeger} onCheckedChange={setTraeger} />
          </div>

          {traeger && (
            <>
              <div>
                <label htmlFor="atemschutzUntersuchungAm" className="mb-1 block text-[13px] font-medium text-ink">
                  Untersuchung am
                </label>
                <Input
                  id="atemschutzUntersuchungAm"
                  name="atemschutzUntersuchungAm"
                  type="date"
                  value={untersuchungAm}
                  onChange={(event) => handleUntersuchungChange(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="atemschutzGueltigBis" className="mb-1 block text-[13px] font-medium text-ink">
                  Gültig bis
                </label>
                <Input
                  id="atemschutzGueltigBis"
                  name="atemschutzGueltigBis"
                  type="date"
                  value={gueltigBis}
                  onChange={(event) => handleGueltigBisChange(event.target.value)}
                />
                <p className="mt-1 text-xs text-ink-faint">Standard 5 Jahre, laut Arzt auch kürzer möglich.</p>
              </div>
              <div>
                <label htmlFor="atemschutzFinnentestAm" className="mb-1 block text-[13px] font-medium text-ink">
                  Finnentest am
                </label>
                <Input
                  id="atemschutzFinnentestAm"
                  name="atemschutzFinnentestAm"
                  type="date"
                  value={finnentestAm}
                  onChange={(event) => setFinnentestAm(event.target.value)}
                />
                <p className="mt-1 text-xs text-ink-faint">Gültigkeit fix 1 Jahr.</p>
              </div>
            </>
          )}
          {state.error && <p className="text-sm text-danger">{state.error}</p>}
        </form>
        <DialogFooter>
          <Button type="submit" form={`atemschutz-form-${target.userId}`} disabled={pending}>
            {pending ? 'Speichern…' : 'Speichern'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
