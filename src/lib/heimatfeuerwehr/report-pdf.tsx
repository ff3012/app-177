import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { ACTIVITY_KINDS, MATERIALS, EQUIPMENT, FUNKTION_LABEL, REPORT_TYPE_LABEL } from './report-constants';

export interface ReportForPdf {
  number: number;
  year: number;
  type: 'ACTIVITY' | 'EXERCISE' | 'INCIDENT';
  fireDepartmentName: string;
  /** data: URI (image/png;base64,...) aus Organization.wappenImageData/wappenImageMimeType, oder null
   * wenn die Feuerwehr kein Wappen hinterlegt hat - dann bleibt die Kopfzeile dort einfach frei. */
  wappenDataUri: string | null;
  filledByName: string;
  filledByStbNr: string | null;
  startAt: Date;
  endAt: Date;
  ownActivity: boolean;
  activityKinds: string[];
  activityOther: string | null;
  vehicles: { label: string; km: number }[];
  remark: string;
  members: { name: string; stbNr: string | null; funktion: string; vehicleLabel: string | null }[];
  materials: { code: string; value: number }[];
  equipment: { code: string; value: number }[];
}

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 10, fontFamily: 'Helvetica' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  wappen: { width: 32, height: 32, marginRight: 8, objectFit: 'contain' },
  title: { fontSize: 15, fontWeight: 700 },
  section: { marginBottom: 8 },
  sectionTitle: { fontSize: 11, fontWeight: 700, marginBottom: 3 },
  row: { flexDirection: 'row' },
  spacerLine: { height: 10 },
  divider: { borderBottomWidth: 0.5, borderColor: '#999', marginTop: 4 },
  checkbox: { width: 9, height: 9, borderWidth: 1, borderColor: '#000', marginRight: 4 },
  checkboxChecked: { backgroundColor: '#000' },
  table: { borderTopWidth: 1, borderColor: '#000' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#999', paddingVertical: 2 },
  tableCell: { flex: 1, paddingHorizontal: 2 },
  tableCellRight: { flex: 1, paddingHorizontal: 2, textAlign: 'right' },
  memberHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#000', paddingVertical: 2 },
  memberHeaderCell: { fontWeight: 700 },
  memberNameCell: { flex: 2, paddingHorizontal: 2 },
  memberStbCell: { flex: 1, paddingHorizontal: 2 },
  memberFunktionCell: { flex: 1, paddingHorizontal: 2 },
  memberVehicleCell: { flex: 1, paddingHorizontal: 2 },
  footer: { marginTop: 14, flexDirection: 'row', justifyContent: 'space-between' },
});

/** "FF Wolfsgraben" -> "Feuerwehr Wolfsgraben" für den Ausdruck (auf ausdrücklichen Wunsch, statt der
 * in Organization.name gespeicherten Kurzform "FF ...", siehe prisma/seed.ts). Ein Name ohne dieses
 * Präfix (z. B. ein Abschnittskommando) bleibt unverändert. */
function formatFireDepartmentName(name: string): string {
  return name.startsWith('FF ') ? `Feuerwehr ${name.slice(3)}` : name;
}

function formatDateTime(date: Date): string {
  return `${date.toLocaleDateString('de-AT')} ${date.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}`;
}

function ReportDocument({ report }: { report: ReportForPdf }) {
  // Einzelauswahl: activityKinds enthält höchstens einen Code (siehe activity-kind-picker.tsx) -
  // Label direkt auflösen statt aller 39 Optionen mit Checkboxen (vorheriges Verhalten, auf
  // ausdrücklichen Wunsch geändert: nur die tatsächlich gewählte Tätigkeitsart im Ausdruck zeigen).
  const selectedKindLabel =
    report.activityKinds.length > 0
      ? (ACTIVITY_KINDS.find((option) => option.code === report.activityKinds[0])?.label ?? report.activityKinds[0])
      : report.activityOther
        ? `Sonstige: ${report.activityOther}`
        : '-';
  // Nur tatsächlich verwendetes Material/Geräte zeigen (Wert > 0), nicht mehr alle 9/5 Zeilen inkl.
  // Nullwerten - ebenfalls auf ausdrücklichen Wunsch geändert.
  const usedMaterials = MATERIALS.filter((option) => (report.materials.find((m) => m.code === option.code)?.value ?? 0) > 0);
  const usedEquipment = EQUIPMENT.filter((option) => (report.equipment.find((e) => e.code === option.code)?.value ?? 0) > 0);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            {report.wappenDataUri && <Image src={report.wappenDataUri} style={styles.wappen} />}
            <Text style={styles.title}>{REPORT_TYPE_LABEL[report.type].toUpperCase()}</Text>
          </View>
          <Text>
            {formatFireDepartmentName(report.fireDepartmentName)} · App-17 | {String(report.number).padStart(3, '0')}/{report.year}
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text>Von: {formatDateTime(report.startAt)}</Text>
            <Text style={{ marginLeft: 16 }}>Bis: {formatDateTime(report.endAt)}</Text>
          </View>
          <View style={styles.spacerLine} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <Text>Eigene Tätigkeit: </Text>
            <View style={[styles.checkbox, report.ownActivity ? styles.checkboxChecked : {}]} />
            <Text style={{ marginRight: 8 }}> Ja</Text>
            <View style={[styles.checkbox, !report.ownActivity ? styles.checkboxChecked : {}]} />
            <Text> Nein</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tätigkeitsart</Text>
          <Text>{selectedKindLabel}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bemerkung</Text>
          <Text>{report.remark}</Text>
          {report.remark.trim().length > 0 && <View style={styles.divider} />}
        </View>

        <View style={styles.section}>
          <Text>
            Fahrzeuge:{' '}
            {report.vehicles.length > 0 ? report.vehicles.map((v) => `${v.label} (${v.km} km)`).join(', ') : 'Keine'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Eingesetzte Mitglieder</Text>
          <View style={styles.table}>
            <View style={styles.memberHeaderRow}>
              <Text style={[styles.memberNameCell, styles.memberHeaderCell]}>Name</Text>
              <Text style={[styles.memberStbCell, styles.memberHeaderCell]}>Stb.-Nr.</Text>
              <Text style={[styles.memberFunktionCell, styles.memberHeaderCell]}>Funktion</Text>
              <Text style={[styles.memberVehicleCell, styles.memberHeaderCell]}>Fahrzeug</Text>
            </View>
            {report.members.map((member, index) => (
              <View key={index} style={styles.tableRow}>
                <Text style={styles.memberNameCell}>{member.name}</Text>
                <Text style={styles.memberStbCell}>{member.stbNr ?? '-'}</Text>
                <Text style={styles.memberFunktionCell}>{FUNKTION_LABEL[member.funktion] ?? member.funktion}</Text>
                <Text style={styles.memberVehicleCell}>{member.vehicleLabel ?? '-'}</Text>
              </View>
            ))}
            {report.members.length === 0 && (
              <View style={styles.tableRow}>
                <Text style={styles.memberNameCell}>Keine</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Verbrauchsmaterial</Text>
          <View style={styles.table}>
            {usedMaterials.map((option) => {
              const value = report.materials.find((m) => m.code === option.code)?.value ?? 0;
              return (
                <View key={option.code} style={styles.tableRow}>
                  <Text style={styles.tableCell}>{option.label}</Text>
                  <Text style={styles.tableCellRight}>{value}</Text>
                </View>
              );
            })}
            {usedMaterials.length === 0 && (
              <View style={styles.tableRow}>
                <Text style={styles.tableCell}>Keines</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Eingesetzte Geräte</Text>
          <View style={styles.table}>
            {usedEquipment.map((option) => {
              const value = report.equipment.find((e) => e.code === option.code)?.value ?? 0;
              return (
                <View key={option.code} style={styles.tableRow}>
                  <Text style={styles.tableCell}>{option.label}</Text>
                  <Text style={styles.tableCellRight}>{value}</Text>
                </View>
              );
            })}
            {usedEquipment.length === 0 && (
              <View style={styles.tableRow}>
                <Text style={styles.tableCell}>Keine</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.footer}>
          <Text>
            Ausgefüllt: {report.filledByName} ({report.filledByStbNr ?? '-'}) · {formatDateTime(new Date())}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function generateReportPdf(report: ReportForPdf): Promise<Buffer> {
  return renderToBuffer(<ReportDocument report={report} />);
}

export function reportPdfFileName(number: number, submittedAt: Date): string {
  const yyyymmdd = submittedAt.toISOString().slice(0, 10).replace(/-/g, '');
  return `Taetigkeitsbericht_${String(number).padStart(3, '0')}_${yyyymmdd}.pdf`;
}

/** Einzige Quelle für den S3-Storage-Key eines Berichts-PDFs - vorher an mehreren Stellen
 * (submitReport, beide PDF-Download-Routen) als `${fireDepartmentId}/${pdfFileName}` dupliziert.
 * Mit dem 14-Tage-Aufbewahrungs-Cron und dem manuellen Löschen-Button kamen zwei weitere Aufrufer
 * dazu, die exakt denselben Key treffen müssen (sonst wird beim Löschen das falsche/kein Objekt
 * gefunden) - ab jetzt nur noch hier berechnet. */
export function reportPdfStorageKey(fireDepartmentId: string, number: number, submittedAt: Date): string {
  return `${fireDepartmentId}/${reportPdfFileName(number, submittedAt)}`;
}
