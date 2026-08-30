'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { approveRegistration, rejectRegistration } from './actions';

export interface PendingRegistrationRow {
  id: string;
  firstName: string;
  lastName: string;
  stbNr: string;
  dienstgradLabel: string;
  email: string;
  organizationLabel: string;
}

export function PendingRegistrationsSection({ registrations }: { registrations: PendingRegistrationRow[] }) {
  const [pending, startTransition] = useTransition();

  if (registrations.length === 0) return null;

  function handleApprove(id: string) {
    startTransition(async () => {
      const result = await approveRegistration(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Registrierung genehmigt.');
      }
    });
  }

  function handleReject(id: string) {
    startTransition(async () => {
      const result = await rejectRegistration(id);
      if (result.error) {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-neutral-900">
        Offene Registrierungen ({registrations.length})
      </h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Stb-Nr.</TableHead>
            <TableHead>Dienstgrad</TableHead>
            <TableHead>E-Mail</TableHead>
            <TableHead>Feuerwehr</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {registrations.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                {row.firstName} {row.lastName}
              </TableCell>
              <TableCell>{row.stbNr}</TableCell>
              <TableCell>{row.dienstgradLabel || '–'}</TableCell>
              <TableCell>{row.email}</TableCell>
              <TableCell>{row.organizationLabel}</TableCell>
              <TableCell className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => handleApprove(row.id)}
                  className="rounded bg-brand px-3 py-1 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  Genehmigen
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => handleReject(row.id)}
                  className="rounded border border-neutral-300 px-3 py-1 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
                >
                  Ablehnen
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
