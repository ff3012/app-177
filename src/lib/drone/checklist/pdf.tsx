import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { calcBuffers, formatMeters } from './buffers';
import { viennaDateParts } from './columns';
import type { ChecklistData } from './data';
import {
  ABMELDUNG_LABELS,
  ABSPERRUNG_LABEL,
  ART_LABEL,
  N18_LABEL,
  N19_LABEL,
  N20_LABEL,
  OPERATION_ITEMS,
  POSTFLIGHT_ITEMS,
  PREFLIGHT_ITEMS,
  STEP_TITLES,
  grundlageText,
  stellenText,
  type CheckItem,
} from './labels';

/** Bereits aufgelöste Daten (Namen statt Ids) - das PDF greift nie selbst auf die Datenbank zu. */
export interface ChecklistPdfData {
  id: string;
  groupName: string;
  flightAt: Date;
  data: ChecklistData;
  pilotName: string | null;
  teamleiterName: string | null;
  abschnittsleiterName: string | null;
  helferNames: string[];
  /** Namen der neuen Piloten je Pilotenwechsel (gleiche Reihenfolge wie data.pilotWechsel), null = unbekannt. */
  wechselPilotNames?: (string | null)[];
  droneNames: string[];
  submittedAt: Date | null;
  /** Wer die Bestätigung gesetzt hat; forPilot = ein anderer als der gewählte Pilot (Admin). */
  confirmedBy: { name: string; forPilot: boolean } | null;
}

const RED = '#d42a23';
const GREY = '#666666';

const styles = StyleSheet.create({
  page: { paddingVertical: 28, paddingHorizontal: 30, fontSize: 9.5, fontFamily: 'Helvetica', color: '#1c1c1e' },
  title: { fontSize: 16, fontWeight: 700 },
  subtitle: { fontSize: 10, color: GREY, marginTop: 2 },
  headerBox: { borderBottomWidth: 1.5, borderColor: '#1c1c1e', paddingBottom: 8, marginBottom: 10 },
  section: { marginBottom: 10 },
  sectionTitle: { fontSize: 11, fontWeight: 700, marginBottom: 4, paddingBottom: 2, borderBottomWidth: 0.5, borderColor: '#999' },
  row: { flexDirection: 'row', paddingVertical: 1.5 },
  nr: { width: 32, color: GREY },
  label: { width: 150, color: GREY },
  value: { flex: 1 },
  box: { width: 9, height: 9, borderWidth: 1, borderColor: '#1c1c1e', marginRight: 5, marginTop: 1 },
  boxChecked: { backgroundColor: '#1f8a5b', borderColor: '#1f8a5b' },
  boxOpen: { borderColor: RED },
  openText: { color: RED },
  comment: { marginTop: 3, padding: 4, backgroundColor: '#fdecea', borderLeftWidth: 2, borderColor: RED },
  tableHead: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#1c1c1e', paddingVertical: 2, fontWeight: 700 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#bbb', paddingVertical: 2 },
  cell: { flex: 1, paddingHorizontal: 2 },
  footer: { position: 'absolute', bottom: 14, left: 30, right: 30, fontSize: 8, color: GREY, flexDirection: 'row', justifyContent: 'space-between' },
});

function dash(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '-';
  const text = String(value).trim();
  return text.length > 0 ? text : '-';
}

function formatMeter(value: number | undefined): string {
  return value === undefined ? '-' : `${String(value).replace('.', ',')} m`;
}

function formatViennaDateTime(date: Date): string {
  const { datum, zeit } = viennaDateParts(date);
  const [y, m, d] = datum.split('-');
  return `${d}.${m}.${y} ${zeit}`;
}

function formatIsoTime(value: string | null | undefined): string {
  return value ? formatViennaDateTime(new Date(value)) : 'nicht abgemeldet';
}

function Field({ nr, label, value }: { nr?: string; label: string; value: string }) {
  return (
    <View style={styles.row} wrap={false}>
      <Text style={styles.nr}>{nr ?? ''}</Text>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function CheckRow({ item, checked }: { item: CheckItem; checked: boolean }) {
  return (
    <View style={styles.row} wrap={false}>
      <Text style={styles.nr}>{item.nr}</Text>
      <View style={[styles.box, checked ? styles.boxChecked : styles.boxOpen]} />
      <Text style={[styles.value, checked ? {} : styles.openText]}>
        {item.label}
        {checked ? '' : ' (offen)'}
      </Text>
    </View>
  );
}

function CommentBox({ text }: { text: string | undefined }) {
  if (!text?.trim()) return null;
  return (
    <View style={styles.comment} wrap={false}>
      <Text style={{ fontWeight: 700 }}>Kommentar zu offenen Punkten</Text>
      <Text>{text.trim()}</Text>
    </View>
  );
}

function Section({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {index + 1} · {STEP_TITLES[index]}
      </Text>
      {children}
    </View>
  );
}

function ChecklistDocument({ c }: { c: ChecklistPdfData }) {
  const d = c.data;
  const checks = d.checks ?? {};
  const buffers = d.hoehe && d.hoehe > 0 ? calcBuffers(d.hoehe) : null;
  const flights = d.fluege ?? [];
  const yesNo = (value: string | undefined) => (value === 'ja' ? 'Ja' : value === 'nein' ? 'Nein' : '-');
  const confirmation = d.bestaetigt && c.confirmedBy
    ? c.confirmedBy.forPilot
      ? `Bestätigt durch ${c.confirmedBy.name} für Pilot ${dash(c.pilotName)}`
      : `Bestätigt durch Pilot ${c.confirmedBy.name}`
    : 'Nicht bestätigt';

  return (
    <Document title="Checkliste Drohnenflug">
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBox}>
          <Text style={styles.title}>Checkliste Drohnenflug</Text>
          <Text style={styles.subtitle}>
            {c.groupName} · {formatViennaDateTime(c.flightAt)} · {d.art ? ART_LABEL[d.art] : 'Art nicht angegeben'}
          </Text>
        </View>

        <Section index={0}>
          <Field label="Datum / Uhrzeit" value={formatViennaDateTime(c.flightAt)} />
          <Field label="Art des Fluges" value={d.art ? ART_LABEL[d.art] : '-'} />
          <Field label="Alarmierung / Auftrag von" value={dash(d.alarmVon)} />
          <Field label="Grund des Fluges" value={dash(d.grund)} />
          <Field label="Fluggebiet" value={dash(d.gebiet)} />
          <Field label="Gemeindegebiet" value={dash(d.gemeinde)} />
          <Field label="Eingesetztes Fluggerät" value={c.droneNames.length ? c.droneNames.join(', ') : '-'} />
        </Section>

        <Section index={1}>
          <Field label="Grundlage" value={grundlageText(d)} />
          <Field label="Sichtverbindung" value={dash(d.sicht)} />
          <Field label="Geplante Flughöhe" value={formatMeter(d.hoehe)} />
          {buffers && (
            <>
              <Field label="CV (0,1 · h)" value={`${formatMeters(buffers.cv)} m`} />
              <Field label="GRB (h + CV)" value={`${formatMeters(buffers.grb)} m`} />
              <Field
                label="Abstand Menschenansammlungen"
                value={`${formatMeters(buffers.abstandMenschenansammlungen)} m (GRB + CV + 120 m)`}
              />
            </>
          )}
        </Section>

        <Section index={2}>
          <Field label="Pilot" value={dash(c.pilotName)} />
          <Field label="Teamleiter" value={dash(c.teamleiterName)} />
          {c.droneNames.length > 1 && <Field label="Abschnittsleiter" value={dash(c.abschnittsleiterName)} />}
          <Field label="Gesamt-Einsatzleiter" value={dash(d.el)} />
          <Field label="Helfer" value={c.helferNames.length ? c.helferNames.join(', ') : '-'} />
          <Field label="Weitere Personen" value={dash(d.helferText)} />
        </Section>

        <Section index={3}>
          <Field nr="1" label="Auftrag erteilt am / um" value={`${dash(d.auftragAm)} ${d.auftragUm ?? ''}`.trim()} />
          <Field nr="2" label="Kommunikation" value={dash(d.komm)} />
          <Field nr="3" label="Flugroute / Flugbereich" value={dash(d.route)} />
          <Field nr="4" label="Wetter" value={dash(d.wetter)} />
          <Field nr="5" label="Risikobewertung durchgeführt" value={yesNo(d.risiko)} />
          <Field nr="" label="Ergänzung" value={dash(d.risikoErg)} />
          <Field nr="6" label="TETRA (ISSI)" value={[d.tetra1, d.tetra2, d.tetra3].filter(Boolean).join(' · ') || '-'} />
          <Field nr="7" label="Zuständige Stellen" value={stellenText(d)} />
          <Field nr="8" label="Kontrollzone" value={`${yesNo(d.kontrollzone)}${d.kontrollFreigabe ? ` · Freigabe: ${d.kontrollFreigabe}` : ''}`} />
          <Field nr="9" label="Militärisches Sperrgebiet" value={`${yesNo(d.militaer)}${d.militaerFreigabe ? ` · Freigabe: ${d.militaerFreigabe}` : ''}`} />
          <Field
            nr="10"
            label="Flugplatz in der Nähe"
            value={`${yesNo(d.flugplatz)}${d.flugplatz === 'ja' ? ` · ${dash(d.betriebLaut)} · ${dash(d.betriebVon)}–${dash(d.betriebBis)}` : ''}`}
          />
          <Field nr="11" label="Absperrung" value={d.absperrung ? ABSPERRUNG_LABEL[d.absperrung] : '-'} />
          <Field nr="12" label="Hilfskräfte vorhanden" value={yesNo(d.hilfskraefte)} />
          <Field nr="13" label="Höchstes Hindernis" value={formatMeter(d.hindernis)} />
        </Section>

        <Section index={4}>
          {PREFLIGHT_ITEMS.map((item) => (
            <CheckRow key={item.key} item={item} checked={checks[item.key] === true} />
          ))}
          <Field label="GPS-Satelliten" value={dash(d.gpsSat)} />
          <Field label="Geofencing" value={dash(d.geofence)} />
          <Field label="Höhenlimit" value={formatMeter(d.hoehenlimit)} />
          <CommentBox text={d.kommentar15} />
        </Section>

        <Section index={5}>
          {OPERATION_ITEMS.map((item) => (
            <CheckRow key={item.key} item={item} checked={checks[item.key] === true} />
          ))}
          <CommentBox text={d.kommentar17} />
        </Section>

        <Section index={6}>
          <View style={styles.tableHead} wrap={false}>
            <Text style={styles.cell}>Akku</Text>
            <Text style={styles.cell}>% vor</Text>
            <Text style={styles.cell}>% nach</Text>
            <Text style={styles.cell}>Start</Text>
            <Text style={styles.cell}>Landung</Text>
            <Text style={styles.cell}>Zwischenkontrolle</Text>
          </View>
          {flights.length === 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.cell}>Keine Flüge erfasst</Text>
            </View>
          )}
          {flights.map((f, index) => (
            <View key={index} style={styles.tableRow} wrap={false}>
              <Text style={styles.cell}>{dash(f.akku)}</Text>
              <Text style={styles.cell}>{dash(f.uVor)}</Text>
              <Text style={styles.cell}>{dash(f.uNach)}</Text>
              <Text style={styles.cell}>{dash(f.start)}</Text>
              <Text style={styles.cell}>{dash(f.landung)}</Text>
              <Text style={styles.cell}>{f.zw ? 'Ja' : 'Nein'}</Text>
            </View>
          ))}
          {(d.pilotWechsel ?? []).map((w, index) => {
            const wChecks = w.checks ?? {};
            return (
              <View key={index} style={{ marginTop: 6 }}>
                <Text style={{ fontWeight: 700, marginBottom: 2 }}>Pilotenwechsel {index + 1} - Kontrollen Nr. 15-17 mit neuem Piloten</Text>
                <Field label="Neuer Pilot" value={dash(c.wechselPilotNames?.[index])} />
                <Field label="Zeitpunkt" value={dash(w.zeit)} />
                {PREFLIGHT_ITEMS.map((item) => (
                  <CheckRow key={item.key} item={item} checked={wChecks[item.key] === true} />
                ))}
                <CommentBox text={w.kommentar15} />
                {OPERATION_ITEMS.map((item) => (
                  <CheckRow key={item.key} item={item} checked={wChecks[item.key] === true} />
                ))}
                <CommentBox text={w.kommentar17} />
              </View>
            );
          })}
          <View style={{ marginTop: 4 }}>
            <Field label="Information an EL" value={dash(d.infoEL)} />
            <Field label="Besondere Ereignisse" value={dash(d.ereignisse)} />
          </View>
        </Section>

        <Section index={7}>
          {(Object.keys(ABMELDUNG_LABELS) as (keyof typeof ABMELDUNG_LABELS)[]).map((key) => (
            <Field key={key} nr="" label={`Abmeldung ${ABMELDUNG_LABELS[key]}`} value={formatIsoTime(d.abm?.[key])} />
          ))}
          <Field nr="18" label="Drohne" value={d.n18 ? N18_LABEL[d.n18] : '-'} />
          <Field nr="19" label="Akkus" value={d.n19 ? N19_LABEL[d.n19] : '-'} />
          <Field nr="20" label="Zustand" value={d.n20 ? N20_LABEL[d.n20] : '-'} />
          {POSTFLIGHT_ITEMS.map((item) => (
            <CheckRow key={item.key} item={item} checked={checks[item.key] === true} />
          ))}
          <Field nr="23" label="Archivierung" value="Die Checkliste wird automatisch archiviert." />
        </Section>

        <Section index={8}>
          <Field label="Anmerkungen" value={dash(d.anmerkungen)} />
          <Field label="Bezug zu lfd. Nr." value={dash(d.bezugNr)} />
          <Field label="Bestätigung" value={`${confirmation}${c.submittedAt ? ` · ${formatViennaDateTime(c.submittedAt)}` : ''}`} />
        </Section>

        <View style={styles.footer} fixed>
          <Text>Erstellt mit BFKDO St. Pölten App · Formular v9 · {c.id}</Text>
          <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function generateChecklistPdf(data: ChecklistPdfData): Promise<Buffer> {
  return renderToBuffer(<ChecklistDocument c={data} />);
}
