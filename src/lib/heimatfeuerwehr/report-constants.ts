export interface ActivityKindOption {
  code: string;
  label: string;
  group?: 'FEUERWEHRJUGEND' | 'AUSBILDUNGSPRUEFUNG';
}

// Anzeige-Titel je Gruppe, für ActivityKindPicker's generische Gruppen-Sektion (ersetzt die vormals
// hartkodierte "Feuerwehrjugend"-Sonderbehandlung).
export const ACTIVITY_KIND_GROUP_LABEL: Record<string, string> = {
  FEUERWEHRJUGEND: 'Feuerwehrjugend',
  AUSBILDUNGSPRUEFUNG: 'Ausbildungsprüfungen',
};

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

// Wortgetreu aus der offiziellen Übungsbericht-Papiervorlage extrahiert (Feuerwehr Wolfsgraben,
// Übungsbericht_045_20260603.docx) - 25 Übungsart-Codes plus 8 Ausbildungsprüfungen-Codes, die am
// Formular als eigene Gruppe darunter stehen. Genau wie Tätigkeitsart bewusst Einzelauswahl (siehe
// activity-kind-picker.tsx) - das Papierformular zeigt zwar Kontrollkästchen ohne "nur eine wählbar"-
// Hinweis, aber auf ausdrücklichen Wunsch konsistent mit Tätigkeitsart gehalten.
export const UEBUNGS_ARTEN: ActivityKindOption[] = [
  { code: 'UE_ATEMSCHUTZUEBUNG', label: 'Atemschutzübung' },
  { code: 'UE_BEGEHUNG', label: 'Begehung' },
  { code: 'UE_BEWERBSUEBUNG', label: 'Bewerbsübung' },
  { code: 'UE_BRANDDIENSTUEBUNG', label: 'Branddienstübung' },
  { code: 'UE_CHARGENSCHULUNG', label: 'Chargenschulung' },
  { code: 'UE_FLUGDIENSTUEBUNG', label: 'Flugdienstübung' },
  { code: 'UE_FMD_SCHULUNG', label: 'FMD-Schulung' },
  { code: 'UE_FUNKUEBUNG', label: 'Funkübung' },
  { code: 'UE_GESAMTUEBUNG', label: 'Gesamtübung' },
  { code: 'UE_GRUPPENUEBUNG', label: 'Gruppenübung' },
  { code: 'UE_HOEHENRETTUNGSGRUPPENUEBUNG', label: 'Höhenrettungsgruppenübung' },
  { code: 'UE_KHD_UEBUNG', label: 'KHD-Übung' },
  { code: 'UE_KRAFTFAHRUEBUNG', label: 'Kraftfahrübung' },
  { code: 'UE_SCHADSTOFFUEBUNG', label: 'Schadstoffübung' },
  { code: 'UE_SCHULUNG', label: 'Schulung' },
  { code: 'UE_SPRENGDIENSTUEBUNG', label: 'Sprengdienstübung' },
  { code: 'UE_STRAHLENSCHUTZUEBUNG', label: 'Strahlenschutzübung' },
  { code: 'UE_TAUCHDIENSTUEBUNG', label: 'Tauchdienstübung' },
  { code: 'UE_TECHNISCHE_UEBUNG', label: 'Technische Übung' },
  { code: 'UE_TUNNELUEBUNG', label: 'Tunnelübung' },
  { code: 'UE_WALDBRANDUEBUNG', label: 'Waldbrandübung' },
  { code: 'UE_WASSERDIENSTUEBUNG', label: 'Wasserdienstübung' },
  { code: 'UE_ZUGSUEBUNG', label: 'Zugsübung' },
  { code: 'UE_ZUGSUEBUNG_1_ZUG', label: 'Zugsübung 1. Zug' },
  { code: 'UE_ZUGSUEBUNG_2_ZUG', label: 'Zugsübung 2. Zug' },
  { code: 'AP_VORBEREITUNG_ATEMSCHUTZ', label: 'Vorbereitung AP Atemschutz', group: 'AUSBILDUNGSPRUEFUNG' },
  { code: 'AP_VORBEREITUNG_FEUERWEHRBOOT', label: 'Vorbereitung AP Feuerwehrboot', group: 'AUSBILDUNGSPRUEFUNG' },
  { code: 'AP_VORBEREITUNG_LOESCHEINSATZ', label: 'Vorbereitung AP Löscheinsatz', group: 'AUSBILDUNGSPRUEFUNG' },
  {
    code: 'AP_VORBEREITUNG_TECHNISCHER_EINSATZ',
    label: 'Vorbereitung AP Technischer Einsatz',
    group: 'AUSBILDUNGSPRUEFUNG',
  },
  { code: 'AP_PRUEFUNG_ATEMSCHUTZ', label: 'Prüfung AP Atemschutz', group: 'AUSBILDUNGSPRUEFUNG' },
  { code: 'AP_PRUEFUNG_FEUERWEHRBOOT', label: 'Prüfung AP Feuerwehrboot', group: 'AUSBILDUNGSPRUEFUNG' },
  { code: 'AP_PRUEFUNG_LOESCHEINSATZ', label: 'Prüfung AP Löscheinsatz', group: 'AUSBILDUNGSPRUEFUNG' },
  { code: 'AP_PRUEFUNG_TECHNISCHER_EINSATZ', label: 'Prüfung AP Technischer Einsatz', group: 'AUSBILDUNGSPRUEFUNG' },
];

/** Welche Codeliste für die Tätigkeits-/Übungsart-Auswahl gilt, je nach Report.type - die einzige
 * Stelle, die diese Zuordnung trifft (ActivityKindPicker/Wizard/PDF/E-Mail lesen alle darüber). */
export function getKindOptionsForType(type: string): ActivityKindOption[] {
  return type === 'EXERCISE' ? UEBUNGS_ARTEN : ACTIVITY_KINDS;
}

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

// ACTIVITY und EXERCISE sind aktiv - INCIDENT erscheint im Berichtsart-Sheet weiterhin ausgegraut mit
// "Bald verfügbar", reine UI-Sperre (das Datenmodell unterstützt alle drei Typen bereits).
export const ACTIVE_REPORT_TYPES: readonly string[] = ['ACTIVITY', 'EXERCISE'];
