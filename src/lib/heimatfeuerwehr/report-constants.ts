export interface ActivityKindOption {
  code: string;
  label: string;
  group?: 'FEUERWEHRJUGEND';
}

// Wortgetreu aus der offiziellen NÖ-Landesfeuerwehrverband-Papiervorlage extrahiert (siehe Design-Spec
// docs/superpowers/specs/2026-09-28-taetigkeitsbericht-design.md §1 Punkt 7 und §4) - 39 fixe Codes.
// "Sonstige" (Freitext -> Report.activityOther) ist bewusst NICHT Teil dieser Liste, eigener Mechanismus.
// Diese Datei ist die EINZIGE Quelle für Formular-UI, Speicherung und PDF-Ausdruck - nie hier abweichend
// redeklarieren.
export const ACTIVITY_KINDS: ActivityKindOption[] = [
  { code: 'ATEMSCHUTZ', label: 'Atemschutz' },
  { code: 'AUSBILDUNG', label: 'Ausbildung' },
  { code: 'AUSUEBUNG_DIENSTAUFSICHT', label: 'Ausübung der Dienstaufsicht' },
  { code: 'BERATUNG_BEHOERDEN', label: 'Beratung der Behörden' },
  { code: 'CHARGENSITZUNG', label: 'Chargensitzung' },
  { code: 'DIENSTBESPRECHUNG', label: 'Dienstbesprechung' },
  { code: 'EDV', label: 'EDV' },
  { code: 'FAHRZEUG_GERAETEDIENST_FAHRMEISTER', label: 'Fahrzeug u. Gerätedienst / Fahrmeister' },
  { code: 'FAHRZEUG_GERAETEDIENST_ZEUGMEISTER', label: 'Fahrzeug u. Gerätedienst / Zeugmeister' },
  { code: 'FEUERWEHRBALL', label: 'Feuerwehrball' },
  { code: 'FEUERWEHRFEST', label: 'Feuerwehrfest' },
  { code: 'FEUERWEHRMEDIZINISCHER_DIENST', label: 'Feuerwehrmedizinischer Dienst' },
  { code: 'FJ_ALLG_JUGENDARBEIT', label: 'Allg. Jugendarbeit', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_FACHLICHE_AUSBILDUNG', label: 'feuerwehrfachliche Ausbildung', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_EIGENE_VERANSTALTUNG', label: 'Eigene Veranstaltung', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_HAUS_DER_NOE_FJ', label: 'Haus der NÖ FJ', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_SELBST_VERANSTALTETE_LAGER', label: 'selbst veranstaltete Lager', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_BEZIRKS_ABSCHNITTSLAGERTEILNAHME', label: 'Bezirks/Abschnittslagerteilnahme', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_LANDESLAGERTEILNAHME', label: 'Landeslagerteilnahme', group: 'FEUERWEHRJUGEND' },
  { code: 'INSPEKTION', label: 'Inspektion' },
  { code: 'JOURNALDIENST', label: 'Journaldienst' },
  { code: 'KIRCHGANG', label: 'Kirchgang' },
  { code: 'KOMMANDOBESPRECHUNG', label: 'Kommandobesprechung' },
  { code: 'MITGLIEDERVERSAMMLUNG', label: 'Mitgliederversammlung' },
  { code: 'NACHRICHTENDIENST', label: 'Nachrichtendienst' },
  { code: 'OEFFENTLICHKEITSARBEIT_DOKUMENTATION', label: 'Öffentlichkeitsarbeit und Dokumentation' },
  { code: 'REPRAESENTATION', label: 'Repräsentation' },
  { code: 'SCHADSTOFFDIENST', label: 'Schadstoffdienst' },
  { code: 'SCHRIFTVERKEHR', label: 'Schriftverkehr' },
  { code: 'SONSTIGE_FEUERWEHRTAETIGKEITEN', label: 'sonstige Feuerwehrtätigkeiten' },
  { code: 'SPRENGDIENST', label: 'Sprengdienst' },
  { code: 'STRAHLENSCHUTZDIENST', label: 'Strahlenschutzdienst' },
  { code: 'TAETIGKEIT_IM_FEUERWEHRHAUS', label: 'Tätigkeit im Feuerwehrhaus' },
  { code: 'VERANSTALTUNGEN', label: 'Veranstaltungen' },
  { code: 'VERWALTUNGSTAETIGKEITEN', label: 'Verwaltungstätigkeiten' },
  { code: 'VORBEUGENDER_BRANDSCHUTZ', label: 'Vorbeugender Brandschutz' },
  { code: 'VORTRAEGE_SCHULUNGEN', label: 'Vorträge/Schulungen' },
  { code: 'WARTUNGSARBEITEN', label: 'Wartungsarbeiten' },
  { code: 'WASSERDIENST', label: 'Wasserdienst' },
];

export interface QuantityOption {
  code: string;
  label: string;
  unit: 'LITER' | 'SAECKE' | 'STUECK' | 'BETRIEBSSTUNDEN';
}

export const MATERIALS: QuantityOption[] = [
  { code: 'WASSER', label: 'Wasser', unit: 'LITER' },
  { code: 'SCHAUMMITTEL', label: 'Schaummittel', unit: 'LITER' },
  { code: 'BIOVERSAL', label: 'Bioversal', unit: 'LITER' },
  { code: 'OELBINDEMITTEL', label: 'Ölbindemittel', unit: 'SAECKE' },
  { code: 'PLANEN', label: 'Planen', unit: 'STUECK' },
  { code: 'NASSLOESCHER', label: 'Nasslöscher', unit: 'STUECK' },
  { code: 'SCHAUMLOESCHER', label: 'Schaumlöscher', unit: 'STUECK' },
  { code: 'PULVERLOESCHER', label: 'Pulverlöscher', unit: 'STUECK' },
  { code: 'CO2_LOESCHER', label: 'CO2 Löscher', unit: 'STUECK' },
];

// Die 4 Löscher-Codes werden im Formular (Task 5) als ein Chip "+ Löscher (4)" zusammengefasst, aber als 4
// einzelne ReportQuantity-Zeilen mit je eigenem Wert gespeichert.
export const LOESCHER_CODES = ['NASSLOESCHER', 'SCHAUMLOESCHER', 'PULVERLOESCHER', 'CO2_LOESCHER'];

export const EQUIPMENT: QuantityOption[] = [
  { code: 'ATEMSCHUTZGERAETE', label: 'Atemschutzgeräte', unit: 'STUECK' },
  { code: 'HYDR_RETTUNGSGERAET', label: 'Hydr. Rettungsgerät', unit: 'STUECK' },
  { code: 'STROMA_125KVA', label: 'STROMA-125kVA', unit: 'BETRIEBSSTUNDEN' },
  { code: 'STROMA_60KVA', label: 'STROMA-60kVA', unit: 'BETRIEBSSTUNDEN' },
  { code: 'SPA_200', label: 'SPA-200', unit: 'BETRIEBSSTUNDEN' },
];

export const FUNKTION_LABEL: Record<string, string> = {
  KOMMANDANT: 'Kommandant',
  FAHRER: 'Fahrer',
  MANNSCHAFT: 'Mannschaft',
};

export const REPORT_TYPE_LABEL: Record<string, string> = {
  ACTIVITY: 'Tätigkeitsbericht',
  EXERCISE: 'Übungsbericht',
  INCIDENT: 'Einsatzbericht',
};

// Nur ACTIVITY ist aktiv - die anderen beiden erscheinen im Berichtsart-Sheet (Task 3) ausgegraut mit
// "Bald verfügbar", reine UI-Sperre (das Datenmodell unterstützt alle drei Typen bereits).
export const ACTIVE_REPORT_TYPES: readonly string[] = ['ACTIVITY'];
