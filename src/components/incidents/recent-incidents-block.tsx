'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PhotoUploadSheet } from './photo-upload-sheet';
import { INCIDENT_KIND_LABELS } from '@/lib/validation/incident.schema';
import type { IncidentKind } from '@prisma/client';

interface RecentIncident {
  id: string;
  kind: IncidentKind;
  keyword: string;
  location: string;
  alarmedAt: string;
  photoIds: string[];
  totalPhotoCount: number;
}

export function RecentIncidentsBlock({ incidents }: { incidents: RecentIncident[] }) {
  const [sheetIncidentId, setSheetIncidentId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Einsätze (letzte 24 Stunden)</span>
      {incidents.map((incident) => (
        <div key={incident.id} className="flex flex-col gap-2 rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <Link href={`/meine-feuerwehr/einsaetze/${incident.id}`} className="min-w-0">
              <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                {INCIDENT_KIND_LABELS[incident.kind]}
              </span>
              <div className="mt-1 truncate text-[15px] font-semibold text-[#1c1c1e]">{incident.keyword}</div>
              <div className="text-[13px] text-[#6c6c70]">
                {new Date(incident.alarmedAt).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} · {incident.location}
              </div>
            </Link>
          </div>

          {incident.photoIds.length === 0 ? (
            <p className="text-sm text-neutral-500">Noch keine Fotos vorhanden.</p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {incident.photoIds.map((photoId, index) => {
                const isLast = index === incident.photoIds.length - 1;
                const remaining = incident.totalPhotoCount - incident.photoIds.length;
                return (
                  <Link
                    key={photoId}
                    href={`/meine-feuerwehr/einsaetze/${incident.id}`}
                    className="relative aspect-square overflow-hidden rounded-lg bg-neutral-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- siehe incident-photo-gallery.tsx */}
                    <img
                      src={`/api/incidents/${incident.id}/photos/${photoId}?variant=thumbnail`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    {isLast && remaining > 0 && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-semibold text-white">
                        +{remaining}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => setSheetIncidentId(incident.id)}
            className="self-start text-sm font-medium text-brand"
          >
            Fotos hinzufügen
          </button>
        </div>
      ))}

      {sheetIncidentId && (
        <PhotoUploadSheet
          incidentId={sheetIncidentId}
          open={sheetIncidentId !== null}
          onClose={() => setSheetIncidentId(null)}
          onQueued={() => setSheetIncidentId(null)}
        />
      )}
    </div>
  );
}
