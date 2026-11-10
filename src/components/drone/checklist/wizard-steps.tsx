'use client';

import { useState } from 'react';
import { calcBuffers, formatMeters } from '@/lib/drone/checklist/buffers';
import { viennaDateParts } from '@/lib/drone/checklist/columns';
import type { ChecklistData, PilotWechsel } from '@/lib/drone/checklist/data';
import {
  ABMELDUNG_LABELS,
  ABSPERRUNG_LABEL,
  ART_LABEL,
  GRUNDLAGE_LABEL,
  N18_LABEL,
  N19_LABEL,
  N20_LABEL,
  OPERATION_ITEMS,
  POSTFLIGHT_ITEMS,
  PREFLIGHT_ITEMS,
  STELLEN_OPTIONS,
  grundlageText,
} from '@/lib/drone/checklist/labels';
import {
  MAX_FLIGHT_HEIGHT,
  checkSummary,
  missingForSubmit,
  openOperationCount,
  openPreflightCount,
  type MissingItem,
} from '@/lib/drone/checklist/rules';
import { Card, CheckRow, Choice, Field, InfoBox, MemberPicker, NowButton, NumberInput, Select, TextArea, TextInput, TimeWithNow } from './wizard-fields';

export interface PersonOption {
  id: string;
  name: string;
}
export interface DroneOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface StepProps {
  data: ChecklistData;
  update: (patch: Partial<ChecklistData>) => void;
  members: PersonOption[];
  drones: DroneOption[];
}

const nowTime = () => viennaDateParts(new Date()).zeit;
const nowDate = () => viennaDateParts(new Date()).datum;

function toggleIn(list: string[] | undefined, value: string): string[] {
  const current = list ?? [];
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
}

const memberOptions = (members: PersonOption[]) => members.map((m) => ({ value: m.id, label: m.name }));

/** Schritt 1 · Einsatzdaten */
export function StepEinsatzdaten({ data, update, drones }: StepProps) {
  return (
    <>
      <Card title="Zeitpunkt">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Datum">
            <TextInput type="date" value={data.datum} onChange={(datum) => update({ datum })} />
          </Field>
          <Field label="Uhrzeit">
            <TextInput type="time" value={data.zeit} onChange={(zeit) => update({ zeit })} />
          </Field>
        </div>
        <NowButton label="Jetzt übernehmen" onClick={() => update({ datum: nowDate(), zeit: nowTime() })} />
      </Card>

      <Card title="Art des Fluges *">
        <Choice
          options={[
            { value: 'Einsatz', label: ART_LABEL.Einsatz },
            { value: 'Training', label: ART_LABEL.Training },
          ]}
          value={data.art}
          onChange={(art) => update({ art })}
        />
      </Card>

      <Card title="Einsatzdaten">
        <Field label="Alarmierung / Einsatzauftrag von">
          <TextInput value={data.alarmVon} onChange={(alarmVon) => update({ alarmVon })} />
        </Field>
        <Field label="Grund des Fluges">
          <TextInput value={data.grund} onChange={(grund) => update({ grund })} />
        </Field>
        <Field label="Bezeichnung des Fluggebiets">
          <TextInput value={data.gebiet} onChange={(gebiet) => update({ gebiet })} />
        </Field>
        <Field label="Name des Gemeindegebietes">
          <TextInput value={data.gemeinde} onChange={(gemeinde) => update({ gemeinde })} />
        </Field>
      </Card>

      <Card title="Eingesetztes Fluggerät *" hint="Mindestens eine Drohne Ihrer Gruppe wählen. Deaktivierte Geräte sind nicht wählbar.">
        {drones.length === 0 && <InfoBox tone="amber">Für diese Gruppe sind keine Drohnen hinterlegt.</InfoBox>}
        {drones.map((drone) => {
          const selected = data.drohnen?.includes(drone.id) ?? false;
          return (
            <button
              key={drone.id}
              type="button"
              aria-pressed={selected}
              disabled={!drone.isActive && !selected}
              onClick={() => update({ drohnen: toggleIn(data.drohnen, drone.id) })}
              className={`flex min-h-11 items-center justify-between rounded-lg border px-3 py-2.5 text-left disabled:opacity-50 ${
                selected ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink'
              }`}
            >
              <span className="text-[15px] font-semibold">{drone.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${drone.isActive ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900'}`}>
                {drone.isActive ? 'Einsatzbereit' : 'Deaktiviert'}
              </span>
            </button>
          );
        })}
      </Card>
    </>
  );
}

/** Schritt 2 · Grundlage & Abstände */
export function StepGrundlage({ data, update }: StepProps) {
  const height = data.hoehe;
  const buffers = height !== undefined && height > 0 ? calcBuffers(height) : null;
  const tooHigh = height !== undefined && height > MAX_FLIGHT_HEIGHT;
  return (
    <>
      <Card title="Grundlage des Fluges *">
        <Choice
          columns={1}
          options={(Object.keys(GRUNDLAGE_LABEL) as (keyof typeof GRUNDLAGE_LABEL)[]).map((value) => ({ value, label: GRUNDLAGE_LABEL[value] }))}
          value={data.grundlage}
          onChange={(grundlage) => update({ grundlage })}
        />
        {data.grundlage === 'open' && (
          <Field label="Unterkategorie">
            <Choice options={(['A1', 'A2', 'A3'] as const).map((value) => ({ value, label: value }))} value={data.openKat} onChange={(openKat) => update({ openKat })} />
          </Field>
        )}
        {(data.grundlage === 'acg' || data.grundlage === 'specific') && (
          <Field label="Bescheid (Geschäftszahl)">
            <TextInput value={data.bescheid} onChange={(bescheid) => update({ bescheid })} />
          </Field>
        )}
      </Card>

      <Card title="Sichtverbindung">
        <Choice options={(['VLOS', 'BVLOS'] as const).map((value) => ({ value, label: value }))} value={data.sicht} onChange={(sicht) => update({ sicht })} />
      </Card>

      <Card title="Geplante Flughöhe *">
        <Field label="Flughöhe">
          <NumberInput value={data.hoehe} unit="m" placeholder="z. B. 60" onChange={(hoehe) => update({ hoehe })} />
        </Field>
        {tooHigh && <InfoBox tone="red">Die Flughöhe darf höchstens {MAX_FLIGHT_HEIGHT} m betragen. Mit mehr kann die Checkliste nicht abgeschlossen werden.</InfoBox>}
        {buffers && !tooHigh && (
          <div className="rounded-lg bg-surface-sunken p-3 text-sm text-ink">
            <div className="flex justify-between py-0.5">
              <span>CV (0,1 · h)</span>
              <span className="font-mono">{formatMeters(buffers.cv)} m</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span>GRB (h + CV)</span>
              <span className="font-mono">{formatMeters(buffers.grb)} m</span>
            </div>
            <div className="flex justify-between py-0.5 font-semibold">
              <span>Abstand Menschenansammlungen</span>
              <span className="font-mono">{formatMeters(buffers.abstandMenschenansammlungen)} m</span>
            </div>
            <div className="text-xs text-ink-muted">GRB + CV + 120 m</div>
          </div>
        )}
        <InfoBox tone="amber">
          Zu Menschenansammlungen den angegebenen Abstand einhalten. 1:1-Regel: Der Abstand zu unbeteiligten Personen entspricht mindestens der Flughöhe.
        </InfoBox>
      </Card>
    </>
  );
}

/** Schritt 3 · Team */
export function StepTeam({ data, update, members, drones }: StepProps) {
  const options = memberOptions(members);
  return (
    <>
      <Card title="Piloten">
        <Field label="Pilot *">
          <Select value={data.pilot} onChange={(pilot) => update({ pilot, bestaetigt: false, helfer: (data.helfer ?? []).filter((h) => h !== pilot) })} options={options} />
        </Field>
        <Field label="Teamleiter">
          <Select value={data.teamleiter} onChange={(teamleiter) => update({ teamleiter })} options={options} placeholder="– keiner –" />
        </Field>
        {(data.drohnen?.length ?? 0) > 1 && (
          <Field label="Abschnittsleiter" hint="Nur bei mehr als einer Drohne.">
            <Select value={data.abschnittsleiter} onChange={(abschnittsleiter) => update({ abschnittsleiter })} options={options} placeholder="– keiner –" />
          </Field>
        )}
        <Field label="Gesamt-Einsatzleiter">
          <TextInput value={data.el} onChange={(el) => update({ el })} />
        </Field>
      </Card>
      <Card title="Helfer / Luftraumbeobachter" hint="Mitglieder der Gruppe antippen.">
        <MemberPicker members={members} selected={data.helfer ?? []} excludeIds={data.pilot ? [data.pilot] : []} onToggle={(id) => update({ helfer: toggleIn(data.helfer, id) })} />
        <Field label="Weitere Personen (Externe)">
          <TextArea rows={2} value={data.helferText} onChange={(helferText) => update({ helferText })} />
        </Field>
      </Card>
      {drones.length === 0 && null}
    </>
  );
}

function YesNo<T extends 'ja' | 'nein'>({ value, onChange, order }: { value: T | undefined; onChange: (v: T) => void; order: [T, T] }) {
  return (
    <Choice
      options={order.map((v) => ({ value: v, label: v === 'ja' ? 'Ja' : 'Nein' }))}
      value={value}
      onChange={onChange}
    />
  );
}

/** Schritt 4 · Vorbereitung (Nr. 1-14) */
export function StepVorbereitung({ data, update }: StepProps) {
  return (
    <>
      <Card title="Auftrag und Planung">
        <Field label="Auftrag erteilt am" nr="1">
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2.5">
              <TextInput type="date" value={data.auftragAm} onChange={(auftragAm) => update({ auftragAm })} />
              <TextInput type="time" value={data.auftragUm} onChange={(auftragUm) => update({ auftragUm })} />
            </div>
            <NowButton full label="Jetzt übernehmen" onClick={() => update({ auftragAm: nowDate(), auftragUm: nowTime() })} />
          </div>
        </Field>
        <Field label="Kommunikation / Funk" nr="2">
          <TextInput value={data.komm} onChange={(komm) => update({ komm })} />
        </Field>
        <Field label="Flugroute / Flugbereich festgelegt" nr="3">
          <TextArea rows={2} value={data.route} onChange={(route) => update({ route })} />
        </Field>
        <Field label="Wetter" nr="4">
          <TextInput value={data.wetter} onChange={(wetter) => update({ wetter })} />
        </Field>
      </Card>

      <Card title="Risiko">
        <Field label="Risikobewertung durchgeführt" nr="5">
          <YesNo value={data.risiko} onChange={(risiko) => update({ risiko })} order={['ja', 'nein']} />
        </Field>
        <Field label="Ergänzung zur Risikobewertung">
          <TextArea rows={2} value={data.risikoErg} onChange={(risikoErg) => update({ risikoErg })} />
        </Field>
      </Card>

      <Card title="Funk und Stellen">
        <Field label="TETRA (ISSI)" nr="6">
          <div className="grid grid-cols-3 gap-2">
            <TextInput inputMode="numeric" value={data.tetra1} placeholder="1" onChange={(tetra1) => update({ tetra1 })} />
            <TextInput inputMode="numeric" value={data.tetra2} placeholder="2" onChange={(tetra2) => update({ tetra2 })} />
            <TextInput inputMode="numeric" value={data.tetra3} placeholder="3" onChange={(tetra3) => update({ tetra3 })} />
          </div>
        </Field>
        <div role="group" aria-labelledby="stellen-label" className="flex flex-col gap-1.5">
          <span id="stellen-label" className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <span className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">7</span>
            Zuständige Stellen verständigt
          </span>
          <span className="flex flex-col gap-2">
            {STELLEN_OPTIONS.map((option) => (
              <CheckRow
                key={option.value}
                label={option.label}
                checked={data.stellenAuswahl?.includes(option.value) ?? false}
                onToggle={() => update({ stellenAuswahl: toggleIn(data.stellenAuswahl, option.value) as typeof data.stellenAuswahl })}
              />
            ))}
          </span>
          <span className="text-xs text-ink-muted">Mehrfachauswahl möglich.</span>
        </div>
        <Field label="Weitere Stellen">
          <TextInput value={data.stellen} placeholder="z. B. Polizei, Bergrettung" onChange={(stellen) => update({ stellen })} />
        </Field>
      </Card>

      <Card title="Luftraum">
        <Field label="Kontrollzone" nr="8">
          <YesNo value={data.kontrollzone} onChange={(kontrollzone) => update({ kontrollzone })} order={['nein', 'ja']} />
        </Field>
        {data.kontrollzone === 'ja' && (
          <Field label="Freigabe durch">
            <TextInput value={data.kontrollFreigabe} onChange={(kontrollFreigabe) => update({ kontrollFreigabe })} />
          </Field>
        )}
        <Field label="Militärisches Sperrgebiet" nr="9">
          <YesNo value={data.militaer} onChange={(militaer) => update({ militaer })} order={['nein', 'ja']} />
        </Field>
        {data.militaer === 'ja' && (
          <Field label="Freigabe durch">
            <TextInput value={data.militaerFreigabe} onChange={(militaerFreigabe) => update({ militaerFreigabe })} />
          </Field>
        )}
        <Field label="Flugplatz in der Nähe" nr="10">
          <YesNo value={data.flugplatz} onChange={(flugplatz) => update({ flugplatz })} order={['nein', 'ja']} />
        </Field>
        {data.flugplatz === 'ja' && (
          <>
            <Field label="Betriebsleiter">
              <TextInput value={data.betriebLaut} onChange={(betriebLaut) => update({ betriebLaut })} />
            </Field>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Betrieb von">
                <TextInput type="time" value={data.betriebVon} onChange={(betriebVon) => update({ betriebVon })} />
              </Field>
              <Field label="Betrieb bis">
                <TextInput type="time" value={data.betriebBis} onChange={(betriebBis) => update({ betriebBis })} />
              </Field>
            </div>
          </>
        )}
      </Card>

      <Card title="Absicherung">
        <Field label="Absperrung" nr="11">
          <Choice
            options={(['keine', '5', '10', '30'] as const).map((value) => ({ value, label: ABSPERRUNG_LABEL[value] }))}
            value={data.absperrung}
            onChange={(absperrung) => update({ absperrung })}
          />
        </Field>
        <Field label="Hilfskräfte vorhanden" nr="12">
          <YesNo value={data.hilfskraefte} onChange={(hilfskraefte) => update({ hilfskraefte })} order={['ja', 'nein']} />
        </Field>
        <Field label="Höchstes Hindernis im Flugbereich" nr="13">
          <NumberInput value={data.hindernis} unit="m" onChange={(hindernis) => update({ hindernis })} />
        </Field>
      </Card>
    </>
  );
}

function GateBox({ open, total, hasComment, onComment, comment, label }: { open: number; total: number; hasComment: boolean; onComment: (v: string) => void; comment: string | undefined; label: string }) {
  if (open === 0) return <InfoBox tone="green">Alle Punkte erledigt.</InfoBox>;
  return (
    <div className="flex flex-col gap-2.5">
      <InfoBox tone="red">
        {open} von {total} Punkten offen: Weiter erst mit Kommentar.
      </InfoBox>
      <Field label={label}>
        <TextArea rows={3} value={comment} onChange={onComment} />
      </Field>
      {!hasComment && <span className="text-xs text-red-800">Pflichtfeld, solange Punkte offen sind.</span>}
    </div>
  );
}

/** Schritt 5 · Vorflugkontrolle (Nr. 15-16) */
export function StepVorflug({ data, update }: StepProps) {
  const checks = data.checks ?? {};
  const open = openPreflightCount(data);
  const toggle = (key: string) => update({ checks: { ...checks, [key]: !checks[key] } });
  return (
    <>
      <Card title="Kontrollpunkte Nr. 15–16" hint="Jeden Punkt abhaken oder unten einen Kommentar eintragen.">
        {PREFLIGHT_ITEMS.map((item) => (
          <CheckRow
            key={item.key}
            nr={item.nr}
            label={item.label}
            checked={checks[item.key] === true}
            onToggle={() => toggle(item.key)}
            hint={item.key === 'p_rthh' && data.hindernis ? `Höchstes Hindernis ${data.hindernis} m → RTH-Höhe mindestens ${data.hindernis + 10} m` : undefined}
          />
        ))}
        <GateBox
          open={open}
          total={PREFLIGHT_ITEMS.length}
          hasComment={!!data.kommentar15?.trim()}
          comment={data.kommentar15}
          onComment={(kommentar15) => update({ kommentar15 })}
          label="Kommentar zu den offenen Punkten"
        />
      </Card>
      <Card title="Einstellungen">
        <Field label="GPS-Satelliten">
          <TextInput inputMode="numeric" value={data.gpsSat} onChange={(gpsSat) => update({ gpsSat })} />
        </Field>
        <Field label="Geofencing / Flugbeschränkung">
          <TextInput value={data.geofence} onChange={(geofence) => update({ geofence })} />
        </Field>
        <Field label="Höhenlimit">
          <NumberInput value={data.hoehenlimit} unit="m" onChange={(hoehenlimit) => update({ hoehenlimit })} />
        </Field>
      </Card>
    </>
  );
}

/** Schritt 6 · Betriebskontrolle (Nr. 17) */
export function StepBetrieb({ data, update }: StepProps) {
  const checks = data.checks ?? {};
  const open = openOperationCount(data);
  const toggle = (key: string) => update({ checks: { ...checks, [key]: !checks[key] } });
  return (
    <>
      {open === 0 ? (
        <InfoBox tone="green">Alle Checks OK – Flug kann durchgeführt werden.</InfoBox>
      ) : (
        <InfoBox tone="amber">
          {open} von {OPERATION_ITEMS.length} Checks offen.
        </InfoBox>
      )}
      <Card title="Startprozedere Nr. 17">
        {OPERATION_ITEMS.map((item) => (
          <CheckRow key={item.key} nr={item.nr} label={item.label} checked={checks[item.key] === true} onToggle={() => toggle(item.key)} />
        ))}
        <InfoBox tone="amber">Abdriften von mehr als 1 m: landen und kalibrieren. Rasche Entladung des Akkus: Akku wechseln.</InfoBox>
        <GateBox
          open={open}
          total={OPERATION_ITEMS.length}
          hasComment={!!data.kommentar17?.trim()}
          comment={data.kommentar17}
          onComment={(kommentar17) => update({ kommentar17 })}
          label="Kommentar zu den offenen Punkten"
        />
      </Card>
    </>
  );
}

/** Schritt 7 · Flüge & Akkus - mit dem zweiten Tab "Piloten Wechsel" (Kontrollen Nr. 15-17 mit neuem Piloten). */
export function StepFluege(props: StepProps) {
  const [tab, setTab] = useState<'fluege' | 'wechsel'>('fluege');
  const count = props.data.pilotWechsel?.length ?? 0;
  const tabs = [
    { key: 'fluege' as const, label: 'Flüge' },
    { key: 'wechsel' as const, label: count > 0 ? `Piloten Wechsel (${count})` : 'Piloten Wechsel' },
  ];
  return (
    <>
      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-sunken p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`min-h-11 touch-manipulation rounded-lg px-2 text-[15px] font-semibold ${tab === t.key ? 'bg-surface text-ink shadow-card' : 'text-ink-muted'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'fluege' ? <FluegeTab {...props} /> : <PilotWechselTab {...props} />}
    </>
  );
}

/** Tab "Piloten Wechsel": jeder Wechsel wiederholt die Vorflug- (Nr. 15-16) und Betriebskontrolle (Nr. 17) mit dem neuen Piloten. */
function PilotWechselTab({ data, update, members }: StepProps) {
  const wechsel = data.pilotWechsel ?? [];
  const nameOf = (id: string | undefined) => members.find((m) => m.id === id)?.name;
  const setWechsel = (index: number, patch: Partial<PilotWechsel>) =>
    update({ pilotWechsel: wechsel.map((w, i) => (i === index ? { ...w, ...patch } : w)) });
  return (
    <>
      <InfoBox tone="amber">Bei einem Pilotenwechsel müssen die Kontrollen Nr. 15–17 mit dem neuen Piloten nochmals durchgeführt werden.</InfoBox>
      {wechsel.map((w, index) => {
        const previous = index === 0 ? data.pilot : wechsel[index - 1].pilot;
        const checks = w.checks ?? {};
        const toggle = (key: string) => setWechsel(index, { checks: { ...checks, [key]: !checks[key] } });
        const openPre = openPreflightCount(w);
        const openOp = openOperationCount(w);
        return (
          <div key={index} className="flex flex-col gap-3.5">
            <Card title={`Pilotenwechsel ${index + 1}`} hint={previous ? `Bisheriger Pilot: ${nameOf(previous) ?? '-'}` : undefined}>
              <Field label="Neuer Pilot *">
                <Select
                  value={w.pilot}
                  onChange={(pilot) => setWechsel(index, { pilot })}
                  options={memberOptions(members.filter((m) => m.id !== previous))}
                />
              </Field>
              <Field label="Zeitpunkt des Wechsels">
                <TimeWithNow value={w.zeit} onChange={(zeit) => setWechsel(index, { zeit })} />
              </Field>
            </Card>
            <Card title="Vorflugkontrolle Nr. 15–16" hint="Mit dem neuen Piloten nochmals durchführen.">
              {PREFLIGHT_ITEMS.map((item) => (
                <CheckRow key={item.key} nr={item.nr} label={item.label} checked={checks[item.key] === true} onToggle={() => toggle(item.key)} />
              ))}
              <GateBox
                open={openPre}
                total={PREFLIGHT_ITEMS.length}
                hasComment={!!w.kommentar15?.trim()}
                comment={w.kommentar15}
                onComment={(kommentar15) => setWechsel(index, { kommentar15 })}
                label="Kommentar zu den offenen Punkten"
              />
            </Card>
            <Card title="Betriebskontrolle Nr. 17" hint="Mit dem neuen Piloten nochmals durchführen.">
              {OPERATION_ITEMS.map((item) => (
                <CheckRow key={item.key} nr={item.nr} label={item.label} checked={checks[item.key] === true} onToggle={() => toggle(item.key)} />
              ))}
              <GateBox
                open={openOp}
                total={OPERATION_ITEMS.length}
                hasComment={!!w.kommentar17?.trim()}
                comment={w.kommentar17}
                onComment={(kommentar17) => setWechsel(index, { kommentar17 })}
                label="Kommentar zu den offenen Punkten"
              />
            </Card>
            <button
              type="button"
              onClick={() => update({ pilotWechsel: wechsel.filter((_, i) => i !== index) })}
              className="min-h-11 self-start text-sm font-semibold text-red-700"
            >
              Diesen Pilotenwechsel entfernen
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => update({ pilotWechsel: [...wechsel, { zeit: nowTime() }] })}
        className="min-h-11 rounded-lg border border-dashed border-line-strong bg-surface px-4 text-[15px] font-semibold text-ink"
      >
        + Pilotenwechsel erfassen
      </button>
    </>
  );
}

function FluegeTab({ data, update }: StepProps) {
  const fluege = data.fluege && data.fluege.length > 0 ? data.fluege : [{}];
  const setFlug = (index: number, patch: Partial<(typeof fluege)[number]>) =>
    update({ fluege: fluege.map((f, i) => (i === index ? { ...f, ...patch } : f)) });
  return (
    <>
      {fluege.map((flug, index) => (
        <Card key={index} title={`Flug ${index + 1}`}>
          <Field label="Akku (Bezeichnung)">
            <TextInput value={flug.akku} onChange={(akku) => setFlug(index, { akku })} />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Akku vor dem Flug (%)">
              <TextInput inputMode="numeric" value={flug.uVor} onChange={(uVor) => setFlug(index, { uVor })} />
            </Field>
            <Field label="Akku nach dem Flug (%)">
              <TextInput inputMode="numeric" value={flug.uNach} onChange={(uNach) => setFlug(index, { uNach })} />
            </Field>
          </div>
          <Field label="Start">
            <TimeWithNow value={flug.start} onChange={(start) => setFlug(index, { start })} />
          </Field>
          <Field label="Landung">
            <TimeWithNow value={flug.landung} onChange={(landung) => setFlug(index, { landung })} />
          </Field>
          <CheckRow label="Zwischenflugkontrolle durchgeführt" checked={flug.zw === true} onToggle={() => setFlug(index, { zw: !flug.zw })} />
          {fluege.length > 1 && (
            <button type="button" onClick={() => update({ fluege: fluege.filter((_, i) => i !== index) })} className="min-h-11 self-start text-sm font-semibold text-red-700">
              Diesen Flug entfernen
            </button>
          )}
        </Card>
      ))}
      <button
        type="button"
        onClick={() => update({ fluege: [...fluege, {}] })}
        className="min-h-11 rounded-lg border border-dashed border-line-strong bg-surface px-4 text-[15px] font-semibold text-ink"
      >
        + Weiterer Flug
      </button>
      <Card title="Meldungen">
        <Field label="Information an den Einsatzleiter">
          <TextArea value={data.infoEL} onChange={(infoEL) => update({ infoEL })} />
        </Field>
        <Field label="Besondere Ereignisse">
          <TextArea value={data.ereignisse} onChange={(ereignisse) => update({ ereignisse })} />
        </Field>
      </Card>
    </>
  );
}

function formatStamp(iso: string): string {
  const { datum, zeit } = viennaDateParts(new Date(iso));
  const [y, m, d] = datum.split('-');
  return `${d}.${m}.${y} ${zeit}`;
}

/** Schritt 8 · Einsatzende & Nachkontrolle (Nr. 18-23) */
export function StepEinsatzende({ data, update }: StepProps) {
  const abm = data.abm ?? {};
  const checks = data.checks ?? {};
  const toggleAbm = (key: keyof typeof ABMELDUNG_LABELS) => update({ abm: { ...abm, [key]: abm[key] ? null : new Date().toISOString() } });
  return (
    <>
      <Card title="Abmelden" hint="Antippen setzt die aktuelle Zeit, erneutes Antippen setzt zurück.">
        {(Object.keys(ABMELDUNG_LABELS) as (keyof typeof ABMELDUNG_LABELS)[]).map((key) => {
          const stamp = abm[key];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={!!stamp}
              onClick={() => toggleAbm(key)}
              className={`flex min-h-11 items-center justify-between rounded-lg border px-3 py-2.5 text-left ${stamp ? 'border-[#1f8a5b] bg-green-50' : 'border-line-strong bg-surface'}`}
            >
              <span className="text-[15px] font-semibold text-ink">{ABMELDUNG_LABELS[key]}</span>
              <span className="text-sm text-ink-muted">{stamp ? formatStamp(stamp) : 'Jetzt abmelden'}</span>
            </button>
          );
        })}
      </Card>
      <Card title="Nachkontrolle">
        <Field label="Drohne" nr="18">
          <Choice columns={1} options={(Object.keys(N18_LABEL) as (keyof typeof N18_LABEL)[]).map((value) => ({ value, label: N18_LABEL[value] }))} value={data.n18} onChange={(n18) => update({ n18 })} />
        </Field>
        <Field label="Akkus" nr="19">
          <Choice columns={1} options={(Object.keys(N19_LABEL) as (keyof typeof N19_LABEL)[]).map((value) => ({ value, label: N19_LABEL[value] }))} value={data.n19} onChange={(n19) => update({ n19 })} />
        </Field>
        <Field label="Zustand" nr="20">
          <Choice columns={1} options={(Object.keys(N20_LABEL) as (keyof typeof N20_LABEL)[]).map((value) => ({ value, label: N20_LABEL[value] }))} value={data.n20} onChange={(n20) => update({ n20 })} />
        </Field>
      </Card>
      <Card title="Prüfpunkte Nr. 21–22">
        {POSTFLIGHT_ITEMS.map((item) => (
          <CheckRow key={item.key} nr={item.nr} label={item.label} checked={checks[item.key] === true} onToggle={() => update({ checks: { ...checks, [item.key]: !checks[item.key] } })} />
        ))}
      </Card>
      <InfoBox tone="amber">Nr. 23: Die Checkliste wird nach dem Abschluss automatisch archiviert.</InfoBox>
    </>
  );
}

function summaryText(group: { open: number; total: number; commented: boolean }): string {
  if (group.open === 0) return `alle ${group.total} erledigt`;
  return `${group.open} von ${group.total} offen${group.commented ? ' (mit Kommentar)' : ''}`;
}

/** Schritt 9 · Abschluss */
export function StepAbschluss({
  data,
  update,
  members,
  drones,
  canConfirm,
  goToStep,
}: StepProps & { canConfirm: boolean; goToStep: (step: number) => void }) {
  const missing: MissingItem[] = missingForSubmit(data);
  const pilotName = members.find((m) => m.id === data.pilot)?.name ?? '-';
  const droneNames = (data.drohnen ?? []).map((id) => drones.find((d) => d.id === id)?.name).filter(Boolean).join(', ') || '-';
  const buffers = data.hoehe && data.hoehe > 0 ? calcBuffers(data.hoehe) : null;
  const summary = checkSummary(data);
  return (
    <>
      <Card title="Zusammenfassung">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-ink-muted">Art</dt>
          <dd className="text-ink">{data.art ? ART_LABEL[data.art] : '-'}</dd>
          <dt className="text-ink-muted">Fluggebiet</dt>
          <dd className="text-ink">{data.gebiet?.trim() || data.gemeinde?.trim() || '-'}</dd>
          <dt className="text-ink-muted">Fluggerät</dt>
          <dd className="text-ink">{droneNames}</dd>
          <dt className="text-ink-muted">Grundlage</dt>
          <dd className="text-ink">{grundlageText(data)}</dd>
          <dt className="text-ink-muted">Flughöhe</dt>
          <dd className="text-ink">{data.hoehe ? `${String(data.hoehe).replace('.', ',')} m` : '-'}</dd>
          {buffers && (
            <>
              <dt className="text-ink-muted">Abstand</dt>
              <dd className="text-ink">{formatMeters(buffers.abstandMenschenansammlungen)} m</dd>
            </>
          )}
          <dt className="text-ink-muted">Pilot</dt>
          <dd className="text-ink">{pilotName}</dd>
          <dt className="text-ink-muted">Flüge erfasst</dt>
          <dd className="text-ink">{data.fluege?.length ?? 0}</dd>
          <dt className="text-ink-muted">Vorflug Nr. 15–16</dt>
          <dd className="text-ink">{summaryText(summary.preflight)}</dd>
          <dt className="text-ink-muted">Betrieb Nr. 17</dt>
          <dd className="text-ink">{summaryText(summary.operation)}</dd>
        </dl>
      </Card>

      <Card title="Anmerkungen">
        <Field label="Anmerkungen">
          <TextArea value={data.anmerkungen} onChange={(anmerkungen) => update({ anmerkungen })} />
        </Field>
        <Field label="Bezug zu lfd. Nr.">
          <TextInput value={data.bezugNr} onChange={(bezugNr) => update({ bezugNr })} />
        </Field>
      </Card>

      {missing.filter((m) => m.step !== 8).length > 0 && (
        <Card title="Noch offen">
          {missing
            .filter((m) => m.step !== 8)
            .map((item) => (
              <button
                key={item.text}
                type="button"
                onClick={() => goToStep(item.step)}
                className="flex min-h-11 items-center justify-between rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-left text-sm text-red-900"
              >
                <span>{item.text}</span>
                <span className="font-semibold">Schritt {item.step + 1} ›</span>
              </button>
            ))}
        </Card>
      )}

      <Card title="Bestätigung des Piloten">
        <CheckRow
          label={`Ich bestätige die Richtigkeit der Angaben (Pilot: ${pilotName}).`}
          checked={data.bestaetigt === true}
          onToggle={() => canConfirm && update({ bestaetigt: !data.bestaetigt })}
          hint={canConfirm ? undefined : 'Nur der gewählte Pilot, ein BOS1-Pilot oder ein Admin der Gruppe kann bestätigen.'}
        />
      </Card>
    </>
  );
}
