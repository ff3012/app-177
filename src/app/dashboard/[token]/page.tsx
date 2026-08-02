import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { getValidDashboardToken, touchDashboardTokenUsage } from '@/lib/dashboard/token';
import { getDashboardEvents, getDashboardVehicleBookings, getUpcomingVehicleBookingsCount } from '@/lib/dashboard/data';
import { generateAppQrCodeDataUri } from '@/lib/dashboard/qr-code';
import { ClockDisplay } from './clock-display';
import { HeightFittedList } from '@/components/dashboard/height-fitted-list';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const CATEGORY_COLOR: Record<string, string> = {
  ALLGEMEIN: '#e4322b',
  DROHNENGRUPPE: '#22a06b',
};
const SECTION_WIDE_COLOR = '#f0a92c';

const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function formatEventTime(startsAt: Date, endsAt: Date, allDay: boolean): { top: string; bottom: string } {
  if (allDay) {
    return { top: startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }), bottom: 'ganztags' };
  }
  const start = startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const end = endsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return { top: start, bottom: `bis ${end}` };
}

function formatBookingDate(startsAt: Date): string {
  const now = new Date();
  const isToday = startsAt.toDateString() === now.toDateString();
  return isToday ? 'Heute' : startsAt.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' });
}

function formatBookingTimeRange(startsAt: Date, endsAt: Date): string {
  const start = startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const end = endsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return `${start}–${end}`;
}

export default async function DashboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await getValidDashboardToken(token);
  if (!valid) {
    notFound();
  }

  await touchDashboardTokenUsage(valid.id);

  const organization = await prisma.organization.findUnique({
    where: { id: valid.organizationId },
    select: { name: true, shortName: true },
  });
  if (!organization) {
    notFound();
  }

  const [events, vehicleBookings, totalBookingsCount, qrCodeDataUri] = await Promise.all([
    getDashboardEvents(valid.organizationId),
    getDashboardVehicleBookings(valid.organizationId),
    getUpcomingVehicleBookingsCount(valid.organizationId),
    generateAppQrCodeDataUri(),
  ]);

  const now = new Date();
  const monthLabel = now.toLocaleDateString('de-AT', { month: 'long', year: 'numeric' });

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#f4f4f6] text-[#1c1c1e]" style={{ fontFamily: "'Barlow', system-ui, sans-serif" }}>
      <meta httpEquiv="refresh" content="300" />

      {/* ================= Kopf ================= */}
      <div
        className="flex flex-none items-center justify-between bg-white px-[clamp(20px,2.1vw,44px)]"
        style={{ height: 'clamp(84px, 9vh, 132px)', borderBottom: '4px solid #e4322b' }}
      >
        <div className="flex items-center gap-[22px]">
          <img src="/wappen-afkdo.png" alt={`Wappen ${organization.name}`} className="h-[62px] w-[62px] object-contain" />
          <div className="flex flex-col gap-[5px]">
            <span className="text-[30px] font-bold leading-none tracking-[-0.01em]">{organization.name}</span>
            <span className="dash-section-label font-semibold uppercase leading-none tracking-[0.06em] text-[#6c6c70]">
              Abschnittsfeuerwehrkommando Purkersdorf
            </span>
          </div>
        </div>
        <ClockDisplay />
      </div>

      {/* ================= Inhalt ================= */}
      <div
        className="grid min-h-0 flex-1 gap-[clamp(16px,1.5vw,32px)] overflow-hidden px-[clamp(20px,2.1vw,44px)] pt-[clamp(20px,2.1vw,44px)] grid-cols-1 [@media(max-aspect-ratio:1/1)]:grid-cols-1 dash-sm:grid-cols-[minmax(0,1fr)_minmax(340px,26vw)] dash-md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_clamp(380px,27vw,560px)]"
      >
        {/* ---------- Spalte 1: Termine ---------- */}
        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <div className="flex items-baseline justify-between">
            <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Kommende Termine</span>
            <span className="dash-secondary text-[#6c6c70]">{monthLabel}</span>
          </div>
          {events.length === 0 ? (
            <div className="rounded-xl bg-white p-5 text-[#6c6c70] shadow-sm">Keine kommenden Termine.</div>
          ) : (
            <HeightFittedList minVisible={4} maxVisible={10}>
              {events.map((event) => {
                const color = event.isSectionWide && event.category === 'ALLGEMEIN' ? SECTION_WIDE_COLOR : CATEGORY_COLOR[event.category];
                const time = formatEventTime(event.startsAt, event.endsAt, event.allDay);
                return (
                  <div
                    key={event.id}
                    className="flex items-center gap-[22px] rounded-xl bg-white p-[19px_22px] shadow-sm"
                    style={{ borderLeft: `5px solid ${color}` }}
                  >
                    <div className="w-[74px] flex-none text-center">
                      <div className="text-[40px] font-bold leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                        {String(event.startsAt.getDate()).padStart(2, '0')}
                      </div>
                      <div className="dash-section-label mt-1 font-semibold uppercase tracking-[0.09em] text-[#6c6c70]">
                        {WEEKDAY_SHORT[event.startsAt.getDay()]}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="dash-event-title mb-1.5 font-semibold">{event.title}</div>
                      {event.location && <div className="dash-secondary text-[#6c6c70]">{event.location}</div>}
                    </div>
                    <div className="flex-none text-right">
                      <div className="dash-table-cell font-semibold leading-none">{time.top}</div>
                      <div className="dash-secondary mt-2 leading-none text-[#6c6c70]">{time.bottom}</div>
                    </div>
                  </div>
                );
              })}
            </HeightFittedList>
          )}
        </div>

        {/* ---------- Spalte 2: Fahrzeuge + WASTL ---------- */}
        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <div className="flex items-baseline justify-between">
            <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Ausgeborgte Fahrzeuge</span>
            <span className="dash-secondary text-[#6c6c70]">Nächste 30 Tage</span>
          </div>
          <div className="flex flex-none flex-col overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="grid grid-cols-[clamp(70px,4.5vw,110px)_minmax(160px,1.6fr)_clamp(104px,6.5vw,150px)_minmax(120px,1.4fr)] gap-x-[18px] border-b-2 border-[#1c1c1e] px-6 py-3">
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Datum</span>
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Fahrzeug</span>
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Zeit</span>
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Ausgeborgt von</span>
            </div>
            {vehicleBookings.length === 0 ? (
              <div className="dash-secondary px-6 py-4 text-[#6c6c70]">Keine Fahrzeug-Buchungen in den nächsten 30 Tagen.</div>
            ) : (
              <HeightFittedList minVisible={3} maxVisible={8}>
                {vehicleBookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="grid grid-cols-[clamp(70px,4.5vw,110px)_minmax(160px,1.6fr)_clamp(104px,6.5vw,150px)_minmax(120px,1.4fr)] items-center gap-x-[18px] border-b border-[#f0f0f2] px-6 py-3"
                  >
                    <span className="dash-table-cell font-semibold">{formatBookingDate(booking.startsAt)}</span>
                    <span className="dash-table-cell overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
                      {booking.vehicleTaktischeBezeichnung}
                    </span>
                    <span className="dash-table-cell" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      {formatBookingTimeRange(booking.startsAt, booking.endsAt)}
                    </span>
                    <span className="dash-secondary overflow-hidden text-ellipsis whitespace-nowrap text-[#48484c]">
                      {booking.borrowerName}
                    </span>
                  </div>
                ))}
              </HeightFittedList>
            )}
            <div className="dash-secondary flex-none px-6 py-3 text-[#6c6c70]">
              Buchung über die App unter „Meine Feuerwehr" · {totalBookingsCount}{' '}
              {totalBookingsCount === 1 ? 'Buchung' : 'Buchungen'} in den nächsten 30 Tagen
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl bg-white p-[18px_22px] shadow-sm">
            <div className="flex flex-none items-baseline justify-between">
              <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Lage Niederösterreich</span>
              <span className="dash-secondary text-[#6c6c70]">WASTL · Bezirksalarmzentralen</span>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- proxied same-origin image, next/image's optimizer adds no value here */}
              <img
                src="/api/wastl/overview"
                alt="WASTL Lagekarte Niederösterreich mit Einsatzstatus je Bezirk"
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            </div>
            <div className="flex flex-none items-center justify-between border-t border-[#f0f0f2] pt-[10px]">
              <span className="dash-secondary flex items-center gap-4 text-[#48484c]">
                <span className="flex items-center gap-[7px]">
                  <span className="h-[13px] w-[13px] rounded-[3px]" style={{ backgroundColor: '#5aa552' }} />
                  Normal
                </span>
                <span className="flex items-center gap-[7px]">
                  <span className="h-[13px] w-[13px] rounded-[3px]" style={{ backgroundColor: '#f2c14e' }} />
                  Erhöht
                </span>
                <span className="flex items-center gap-[7px]">
                  <span className="h-[13px] w-[13px] rounded-[3px]" style={{ backgroundColor: '#e06666' }} />
                  Stark
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* ---------- Spalte 3: Facebook + QR ---------- */}
        <div className="flex min-h-0 flex-col gap-5 overflow-hidden">
          {/* Facebook-Platzhalter - wird in Task 11 durch den echten Feed ersetzt */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex flex-none items-baseline justify-between">
              <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Aus unserer Feuerwehr</span>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-white p-[22px] shadow-sm">
              <span className="dash-secondary text-[#6c6c70]">Wird geladen …</span>
            </div>
          </div>

          {/* QR-Platzhalter - wird in Task 6 durch den echten QR-Code ersetzt */}
          <div className="flex flex-none items-center gap-5 rounded-xl bg-[#1c1c1e] p-[20px_22px]">
            <div className="flex h-[clamp(96px,7vw,180px)] w-[clamp(96px,7vw,180px)] flex-none items-center justify-center rounded-lg bg-white p-2">
              <img src={qrCodeDataUri} alt="QR-Code zum App-Download" className="h-full w-full" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-2 text-[22px] font-semibold leading-tight text-white">App installieren</div>
              <div className="dash-secondary mb-3 leading-snug text-[#c9c9ce]">Termine, Fahrzeuge und Atemschutz am Handy.</div>
              <div className="dash-secondary break-all font-semibold text-white" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                app-177.ff-wolfsgraben.at
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ================= Fuß ================= */}
      <div
        className="flex flex-none items-center justify-between border-t border-[#e0e0e4] px-[clamp(20px,2.1vw,44px)]"
        style={{ height: 'clamp(40px, 5vh, 62px)' }}
      >
        <span className="dash-secondary text-[#6c6c70]">Dashboard Feuerwehrhaus · Anzeige aktualisiert sich automatisch</span>
        <span className="dash-secondary text-[#6c6c70]">
          Zuletzt aktualisiert {now.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} · Quellen: App-177, WASTL
          Niederösterreich, Facebook
        </span>
      </div>
    </div>
  );
}
