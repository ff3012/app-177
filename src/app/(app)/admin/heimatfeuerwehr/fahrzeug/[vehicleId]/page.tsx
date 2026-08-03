import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const UTILIZATION_WINDOW_DAYS = 90;

function formatRange(startsAt: Date, endsAt: Date): string {
  const day = startsAt.toLocaleDateString('de-AT');
  const start = startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const end = endsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${start}–${end}`;
}

// Von der Fuhrpark-Tabelle in admin/heimatfeuerwehr/page.tsx aus über einen "Historie"-Link pro
// Zeile erreichbar - zeigt ALLE Buchungen (nicht nur kommende wie auf /meine-feuerwehr) plus eine
// einfache Auslastungskennzahl (gebuchte Stunden in den letzten 90 Tagen).
export default async function FahrzeugHistoriePage({ params }: { params: Promise<{ vehicleId: string }> }) {
  const user = await requireUser();
  const { vehicleId } = await params;

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle || !canManageHeimatfeuerwehrFor(user, vehicle.organizationId)) {
    notFound();
  }

  const bookings = await prisma.vehicleBooking.findMany({
    where: { vehicleId },
    orderBy: { startsAt: 'desc' },
    include: { user: { select: { firstName: true, lastName: true } } },
  });

  const utilizationCutoff = new Date();
  utilizationCutoff.setDate(utilizationCutoff.getDate() - UTILIZATION_WINDOW_DAYS);
  const utilizationHours = bookings
    .filter((booking) => booking.startsAt >= utilizationCutoff)
    .reduce((sum, booking) => sum + (booking.endsAt.getTime() - booking.startsAt.getTime()) / (60 * 60 * 1000), 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/admin/heimatfeuerwehr" className="text-sm text-brand hover:underline">
          ← Zurück zur Heimatfeuerwehr-Verwaltung
        </Link>
        <h1 className="mt-1 text-[28px] font-bold text-ink">{vehicle.taktischeBezeichnung}</h1>
        <p className="text-sm text-ink-muted">
          {vehicle.marke} {vehicle.typ} · {vehicle.kennzeichen}
        </p>
      </div>

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Auslastung</h2>
        <p className="text-sm text-ink-muted">
          <span className="font-condensed text-3xl font-bold text-ink">{utilizationHours.toFixed(1)}</span> Stunden gebucht
          in den letzten {UTILIZATION_WINDOW_DAYS} Tagen
        </p>
      </div>

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Buchungshistorie</h2>
        <Table>
          <TableHeader>
            <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Zeitraum
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Gebucht von
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Details
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Status
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.map((booking) => {
              const past = booking.endsAt.getTime() < Date.now();
              return (
                <TableRow key={booking.id} className="border-line">
                  <TableCell className="text-ink">{formatRange(booking.startsAt, booking.endsAt)}</TableCell>
                  <TableCell className="text-ink-muted">
                    {booking.user.firstName} {booking.user.lastName}
                  </TableCell>
                  <TableCell className="max-w-[240px] whitespace-pre-wrap text-ink-muted">
                    {booking.details || <span className="text-ink-faint">–</span>}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        past
                          ? 'border-transparent bg-surface-sunken text-ink-faint'
                          : 'border-transparent bg-success-subtle text-success-text'
                      }
                    >
                      {past ? 'Vergangen' : 'Kommend'}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
            {bookings.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-ink-muted">
                  Noch keine Buchungen für dieses Fahrzeug.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
