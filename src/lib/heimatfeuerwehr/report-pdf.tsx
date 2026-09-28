import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { ACTIVITY_KINDS, MATERIALS, EQUIPMENT, FUNKTION_LABEL, REPORT_TYPE_LABEL } from './report-constants';

export interface ReportForPdf {
  number: number;
  year: number;
  type: 'ACTIVITY' | 'EXERCISE' | 'INCIDENT';
  fireDepartmentName: string;
  filledByName: string;
  filledByStbNr: string | null;
  startAt: Date;
  endAt: Date;
  ownActivity: boolean;
  activityKinds: string[];
  activityOther: string | null;
  vehicleLabel: string | null;
  vehicleKm: number | null;
  remark: string;
  members: { name: string; stbNr: string | null; funktion: string }[];
  materials: { code: string; value: number }[];
  equipment: { code: string; value: number }[];
}

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: 'Helvetica' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 14, fontWeight: 700 },
  section: { marginBottom: 8 },
  sectionTitle: { fontSize: 10, fontWeight: 700, marginBottom: 3 },
  row: { flexDirection: 'row' },
  twoCol: { flexDirection: 'row', flexWrap: 'wrap' },
  kindItem: { width: '50%', flexDirection: 'row', marginBottom: 2 },
  checkbox: { width: 9, height: 9, borderWidth: 1, borderColor: '#000', marginRight: 4 },
  checkboxChecked: { backgroundColor: '#000' },
  table: { borderTopWidth: 1, borderColor: '#000' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#999', paddingVertical: 2 },
  tableCell: { flex: 1, paddingHorizontal: 2 },
  tableCellRight: { flex: 1, paddingHorizontal: 2, textAlign: 'right' },
  footer: { marginTop: 14, flexDirection: 'row', justifyContent: 'space-between' },
});

function formatDateTime(date: Date): string {
  return `${date.toLocaleDateString('de-AT')} ${date.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}`;
}

function ReportDocument({ report }: { report: ReportForPdf }) {
  const selectedKinds = new Set(report.activityKinds);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{REPORT_TYPE_LABEL[report.type].toUpperCase()}</Text>
          <Text>
            {report.fireDepartmentName} · Nr. {String(report.number).padStart(3, '0')} / {report.year}
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text>Von: {formatDateTime(report.startAt)}</Text>
            <Text style={{ marginLeft: 16 }}>Bis: {formatDateTime(report.endAt)}</Text>
          </View>
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
          <View style={styles.twoCol}>
            {ACTIVITY_KINDS.map((option) => {
              const checked = selectedKinds.has(option.code);
              return (
                <View key={option.code} style={styles.kindItem}>
                  <View style={[styles.checkbox, checked ? styles.checkboxChecked : {}]} />
                  <Text style={checked ? { fontWeight: 700 } : {}}>{option.label}</Text>
                </View>
              );
            })}
            <View style={styles.kindItem}>
              <View style={[styles.checkbox, report.activityOther ? styles.checkboxChecked : {}]} />
              <Text style={report.activityOther ? { fontWeight: 700 } : {}}>
                Sonstige{report.activityOther ? `: ${report.activityOther}` : ''}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bemerkung</Text>
          <Text>{report.remark}</Text>
        </View>

        <View style={styles.section}>
          <Text>
            Fahrzeug: {report.vehicleLabel ?? 'Kein Fahrzeug'}
            {report.vehicleKm !== null ? ` · ${report.vehicleKm} km` : ''}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Eingesetzte Mitglieder</Text>
          {report.members.map((member, index) => (
            <Text key={index}>
              {member.name} ({member.stbNr ?? '-'}) · {FUNKTION_LABEL[member.funktion] ?? member.funktion}
            </Text>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Verbrauchsmaterial</Text>
          <View style={styles.table}>
            {MATERIALS.map((option) => {
              const value = report.materials.find((m) => m.code === option.code)?.value ?? 0;
              return (
                <View key={option.code} style={styles.tableRow}>
                  <Text style={styles.tableCell}>{option.label}</Text>
                  <Text style={styles.tableCellRight}>{value}</Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Eingesetzte Geräte</Text>
          <View style={styles.table}>
            {EQUIPMENT.map((option) => {
              const value = report.equipment.find((e) => e.code === option.code)?.value ?? 0;
              return (
                <View key={option.code} style={styles.tableRow}>
                  <Text style={styles.tableCell}>{option.label}</Text>
                  <Text style={styles.tableCellRight}>{value}</Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.footer}>
          <Text>
            Ausgefüllt: {report.filledByName} ({report.filledByStbNr ?? '-'}) · {formatDateTime(new Date())}
          </Text>
          <Text>Kommandant / Stellvertreter: ______________________</Text>
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
