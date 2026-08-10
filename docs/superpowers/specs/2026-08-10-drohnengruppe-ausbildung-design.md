# Drohnengruppe: 5-stufige Ausbildungsverfolgung

**Status:** Approved, ready for implementation planning.
**Quelle:** Nutzeranfrage, ergänzt die frühere "BOS1 ist eine Ausbildung, die mit Datumsfeld aktiviert
wird, unter Ausbildung Benutzer"-Notiz aus der Brainstorming-Phase der Geltungsbereich-Feature. Deckt
sich mit `Verwaltung-Filter-Brief.md` §6.1 ("Einsatzbereitschaft"/`bos1At`), liefert aber nur die
Datenerfassung - die dort skizzierte Ampel-Übersicht ist eine bewusst spätere, eigene Phase.

## 1. Zweck

Fünf aufeinander aufbauende Ausbildungsstufen für Drohnengruppen-Mitglieder (Piloten UND Admins),
jede mit Datum, jede erst erreichbar, wenn die vorige abgeschlossen ist:

1. A1/A3 Pilotenlizenz
2. A2 Pilotenlizenz (setzt A1/A3 voraus)
3. Stützpunktausbildung (setzt A2 voraus)
4. BOS1 Ausbildung (setzt Stützpunktausbildung voraus)
5. BOS2 Ausbildung (setzt BOS1 voraus)

**Bewusst NICHT Teil dieser Phase:** keine Anzeige/Auswertung der Ausbildungsstufe irgendwo (kein
Badge, keine Ampel, keine bezirksweite Übersicht) - nur Erfassung. Die Daten existieren danach korrekt
und vollständig, eine spätere Phase baut die in `Verwaltung-Filter-Brief.md` §6.1 skizzierte
Einsatzbereitschaft-Ansicht direkt darauf auf.

## 2. Datenmodell

Fünf neue, nullable `DateTime`-Felder auf `DrohnengruppeMembership` (nicht auf `User`) - diese Daten
sind nur für tatsächliche Drohnengruppen-Mitglieder sinnvoll, genau wie `role`/`addedAt` bereits auf
diesem Modell liegen, nicht auf `User`:

```prisma
model DrohnengruppeMembership {
  // ...bestehende Felder...
  a1a3LizenzAm            DateTime?
  a2LizenzAm              DateTime?
  stuetzpunktausbildungAm DateTime?
  bos1AusbildungAm        DateTime?
  bos2AusbildungAm        DateTime?
}
```

Additiv, alle nullable - keine Migration-Backfill-Besonderheit, jede bestehende Mitgliedschaft startet
korrekt bei "keine Stufe erreicht".

## 3. Sequentielle Regel - eine einzige Invariante deckt beide Richtungen ab

"Stufe N ist nur gesetzt, wenn alle Stufen davor auch gesetzt sind" ist eine einzige,
richtungsunabhängige Prüfung des END-Zustands - sie verhindert gleichermaßen "A2 setzen ohne A1/A3"
UND "A1/A3 entfernen, während A2 noch gesetzt ist" (der vom Nutzer gewählte "nur verhindern, nicht
automatisch löschen"-Ansatz), ohne dass Vorher/Nachher verglichen werden muss:

```typescript
const AUSBILDUNGSSTUFEN = [
  'a1a3LizenzAm',
  'a2LizenzAm',
  'stuetzpunktausbildungAm',
  'bos1AusbildungAm',
  'bos2AusbildungAm',
] as const;

function isValidAusbildungsstand(data: Record<(typeof AUSBILDUNGSSTUFEN)[number], string>): boolean {
  let seenGap = false;
  for (const key of AUSBILDUNGSSTUFEN) {
    if (!data[key]) {
      seenGap = true;
    } else if (seenGap) {
      return false; // eine spätere Stufe ist gesetzt, obwohl eine frühere fehlt
    }
  }
  return true;
}
```

Server-seitig als zusätzlicher `.refine()` auf `userSchema` (dieselbe Mehrfach-`.refine()`-Verkettung,
die bereits für die Bezirks-Drohnenadmin-Regel etabliert ist), Fehlermeldung am letzten befüllten Feld
verankert. Clientseitig zusätzlich UX-Komfort: das Datumsfeld einer Stufe ist deaktiviert, solange die
vorige Stufe kein Datum hat (verhindert die meisten ungültigen Eingaben, bevor sie überhaupt beim
Absenden geprüft werden) - die serverseitige Prüfung bleibt trotzdem die eigentliche Absicherung.

## 4. UI

Fünf neue Datumszeilen in `UserFormSheet`, innerhalb des bereits bestehenden, auf `droneRole !==
'NONE'` bedingten Blocks (direkt nach der "Gruppe"-Auswahl) - dort, weil eine Ausbildung nur für ein
tatsächliches Mitglied Sinn ergibt, exakt dieselbe Sichtbarkeitsbedingung wie die "Gruppe"-Auswahl
selbst. Eine neue Zwischenüberschrift "Ausbildung" trennt sie optisch von "Gruppe" darüber. Jede Zeile:
Label + `<Input type="date">` (dasselbe Element wie in `AtemschutzEditDialog`, keine neue
Datums-Komponente nötig, da hier - anders als bei Terminen - keine Uhrzeit relevant ist), deaktiviert
wenn die vorige Stufe kein Datum hat.

Bearbeitbar von jedem, der dieses Formular für diesen Benutzer überhaupt öffnen und die
Drohnengruppen-Zuordnung ändern darf (bestehendes Berechtigungsmodell, keine neue Rechtestufe) -
dieselben Personen, die schon heute Rolle/Gruppe setzen dürfen.

## 5. Server Actions

`syncDroneMembership` (`admin/benutzer/actions.ts`) bekommt die fünf Datumswerte als zusätzliche
Parameter und schreibt sie im bestehenden `upsert` mit (sowohl `create` als auch `update` - beim
Erstanlegen einer Mitgliedschaft können die Stufen theoretisch schon direkt mitgegeben werden, falls
ein Admin eine bereits ausgebildete Person neu in die Gruppe aufnimmt). Die Sequenz-Prüfung aus §3
läuft bereits vor `syncDroneMembership` als Teil der `userSchema`-Validierung in
`createUser`/`updateUser` - `syncDroneMembership` selbst muss die Reihenfolge nicht erneut prüfen,
bekommt aber bereits validierte Werte.

## 6. Umfang / Nicht-Ziele

- Keine Anzeige der erreichten Stufe irgendwo (weder Admin- noch Mitglieder-Ansicht).
- Keine Einsatzbereitschaft-Ampel, keine Bezirks-Übersicht - eigene, spätere Phase.
- Keine Selbstauskunft für Mitglieder (wie bei Atemschutz: nur Einsicht/Bearbeitung durch Admins in
  dieser Phase, kein `/drohnen`-Self-View).
- Keine Änderung an `canViewDroneModule`/`canViewAllFlights` oder sonstigen bestehenden
  Drohnengruppen-Rechten.

## 7. Abnahme

- Ein Admin kann für ein Drohnengruppen-Mitglied (Pilot oder Admin) alle fünf Stufen der Reihe nach
  mit Datum versehen.
- Eine Stufe ohne gesetzte Vorstufe lässt sich weder über die UI noch per direktem Server-Action-Aufruf
  setzen.
- Eine bereits gesetzte Stufe lässt sich nicht entfernen, solange eine höhere Stufe noch gesetzt ist -
  die höheren Stufen müssen zuerst selbst entfernen werden.
- Ein Benutzer ohne Drohnengruppen-Mitgliedschaft (`droneRole === 'NONE'`) sieht die
  Ausbildungsfelder gar nicht.
