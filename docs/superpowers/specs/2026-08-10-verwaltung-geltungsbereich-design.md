# Verwaltung: Geltungsbereich-Wähler (Phase 1+2 von Verwaltung-Filter-Brief.md)

**Status:** Approved, ready for implementation planning.
**Quelle:** `Verwaltung-Filter-Brief.md` (Claude Design, Projekt "Feuerwehr-Verwaltung UI Redesign"),
Grundlage GitHub Issue #10. Der Brief bündelt 7 Phasen (Geltungsbereich-Wähler + URL-Routing,
gemeinsame Filterleiste, Benutzerliste-Umbau, Abschnittsliste, Drohnengruppen-Einsatzbereitschaft,
QR/Drohnen-Zuordnung in der Flugerfassung) - zu groß für einen einzigen Plan. Dieses Dokument deckt
ausschließlich **Phase 1+2** ab: den Geltungsbereich-Wähler selbst und seine serverseitige
Rechte-Grundlage. Alle anderen Phasen folgen als eigene, spätere Specs.

## 1. Zweck

Wer den Bezirk verwaltet, sieht heute in der Benutzerverwaltung/Drohnengruppe/Heimatfeuerwehr
entweder alles ungefiltert oder muss pro Seite eine eigene, isolierte Auswahl treffen
(`/admin/drohnen?group=`, `/admin/heimatfeuerwehr?org=`). Es gibt keinen gemeinsamen Begriff
"auf welcher Ebene (Bezirk/Abschnitt/Feuerwehr) arbeite ich gerade" über die Verwaltung hinweg.
Phase 1+2 führt genau diesen Begriff ein: einen wiederverwendbaren Geltungsbereich-Wähler, der
serverseitig auf die tatsächlichen Rechte des Betrachters geprüft ist, dessen Wahl über
Reload/Navigation hinweg erhalten bleibt und als Link teilbar ist.

**Bewusst NICHT Teil dieser Phase:** Der gewählte Geltungsbereich filtert noch **keine**
bestehende Liste (Benutzerverwaltung, Drohnengruppe, Heimatfeuerwehr) - das ist Phase 3
(gemeinsame Filterleiste) und Phase 4 (Benutzerliste-Umbau), jeweils eigene Specs. Diese Phase
liefert ausschließlich den Wähler selbst: seine Datenbasis, seine UI, seine Persistenz.

## 2. Framework-Einschränkung, die das Design bestimmt

Next.js App-Router-Layouts (`admin/layout.tsx`) erhalten **keine** `searchParams` - nur
`page.tsx`-Dateien tun das. Der "aktuell gewählte Geltungsbereich" kann deshalb nicht als
serverseitiger Layout-State existieren. Lösung: der Geltungsbereich lebt als URL-Query-Parameter
(`?ebene=bezirk|abschnitt|feuerwehr&org=<id>`), aufgelöst **clientseitig** vom Wähler selbst
(`useSearchParams()`), mit `localStorage` als Vorbelegung beim ersten Aufruf ohne Parameter. Jede
`/admin/*`-Seite liest und validiert den Parameter bei Bedarf selbst aus ihrem eigenen
`searchParams`-Prop - genau das Muster, das `/admin/drohnen`s `?group=` und
`/admin/heimatfeuerwehr`s `?org=` heute schon verwenden. Der Nutzer hat explizit entschieden,
**keine** verschachtelten Routen (`/admin/bezirk/17/…`) einzuführen, sondern bei flachen URLs mit
Query-Parametern zu bleiben.

## 3. Datenmodell

Keine Schema-Änderung. `District` (eine Zeile, Bezirk 17), `Organization` (mit `type`,
selbstreferenzierendem `parentId` für Abschnitt→Feuerwehr) und `DroneGroup.organizationId`
bilden bereits genau das ab, was der Brief unter `Section`/`FireDepartment` skizziert - geprüft
gegen die echte Dev-Datenbank, keine Abweichung.

## 4. `src/lib/admin/scope.ts` (neu)

```typescript
export type AdminScope =
  | { level: 'BEZIRK' }
  | { level: 'ABSCHNITT'; organizationId: string; name: string }
  | { level: 'FEUERWEHR'; organizationId: string; name: string; abschnittOrganizationId: string };

export async function getReachableScopes(user: SessionUser): Promise<AdminScope[]>;

export interface ScopeResolution {
  scope: AdminScope;
  /** false, wenn der übergebene Parameter zwar syntaktisch gültig, aber für DIESEN Benutzer nicht
   * erreichbar war (fremder Abschnitt/fremde Feuerwehr per URL) - der Aufrufer entscheidet dann
   * selbst, ob er notFound() wirft oder den Fallback stillschweigend übernimmt. In Phase 1+2 hat
   * das noch keinen Aufrufer außer dem Wähler selbst; ab Phase 3/4, wenn echte Listen danach
   * filtern, wird dieses Feld zur Sicherheitsgrenze. */
  requestedButUnreachable: boolean;
}

export function resolveAdminScope(
  reachable: AdminScope[],
  rawEbene: string | undefined,
  rawOrg: string | undefined,
): ScopeResolution;
```

- `getReachableScopes` lädt `Organization` (alle Abschnittskommandos + alle Feuerwehren mit
  `parentId`) einmal und baut die Liste je nach Rechtetyp:
  - **Bezirksadmin**: `{level:'BEZIRK'}` + alle 7 Abschnitte + alle ~124 Feuerwehren. Das ist
    bewusst eine große flache Liste - genau dafür ist die durchsuchbare Baum-UI aus §2 des Briefs
    gedacht ("bei 125 Feuerwehren ist ein natives `<select>` unbedienbar").
  - **Abschnittsadmin** (Organisation in `abschnittAdminOrgIds`, ohne volles Bezirksadmin-Recht):
    dieser Abschnitt + seine Feuerwehren (`feuerwehrAdminOrgIds`-Vererbung, bereits etabliert).
  - **Reiner Feuerwehr-Admin**: nur die Feuerwehr(en), in denen er direkt ADMIN-Mitglied ist
    (`feuerwehrAdminOrgIds`, abzüglich der über Abschnitts-Vererbung bereits gezählten).
- `resolveAdminScope` ist eine reine Funktion (keine DB, keine Session) - leicht isoliert testbar.
  Fällt bei fehlendem/ungültigem Parameter auf `reachable[0]` zurück (Sortierung: Bezirk vor
  Abschnitt vor Feuerwehr, dann alphabetisch), niemals auf einen Wert außerhalb `reachable`.

## 5. `GeltungsbereichSelector` (neuer Client-Component)

Gleiche Popover+Command-Bauweise wie das bestehende `AdminOrgMultiSelect` (Verwaltungs-Brief.md) -
keine neue UI-Bibliothek nötig.

**Geschlossen** (58px, weiß, Hairline unten): aktuelle Ebene 15px/600 fett, darunter 13px
`ink-faint`-Kontextzeile:
- Bezirk: "`{N}` Abschnitte · `{M}` Feuerwehren"
- Abschnitt: "`{N}` Feuerwehren"
- Feuerwehr: keine Kontextzeile

**Bewusste Vereinfachung gegenüber dem Brief**: der Brief zeigt für Abschnitt zusätzlich eine
Mitgliederzahl ("12 Feuerwehren · 486 Mitglieder"). Diese Zahl hängt vom gerade ausgewählten
Geltungsbereich ab, der - siehe §2 oben - nur clientseitig (`useSearchParams()`) bekannt ist, nicht
in der Server Component, die `getReachableScopes` aufruft. Sie live nachzuladen bräuchte entweder
einen zusätzlichen Client-seitigen Request oder eine Mitgliederzahl für jede der ~132 Organisationen
im Voraus (unnötige Query-Last für Zahlen, die nie angezeigt werden). Für diese schmal geschnittene
Phase reicht die Kontextzeile mit den bereits geladenen Zählwerten aus `reachable` (Abschnitte/
Feuerwehren-Anzahl); Mitgliederzahlen sind ohnehin nur bei tatsächlicher Listen-Filterung (Phase 3/4)
wirklich aussagekräftig und werden dort ergänzt.

**Offen** (Popover 268px, Schatten wie im Brief): Suchfeld oben (filtert alle drei Ebenen
gleichzeitig per Client-seitigem Substring-Match, kein Server-Roundtrip - die Liste ist bereits
vollständig geladen), Baum mit 12px Einrückung je Stufe, nur erreichbare Ebenen (nicht ausgegraut -
weggelassen), aktive Ebene `brand-subtle` hinterlegt.

**Auswahl**: `router.push` auf denselben Pfad mit aktualisierten `?ebene=&org=`-Parametern +
`localStorage.setItem('admin-scope', JSON.stringify({ebene, org}))`.

**Rendering-Bedingung**: nur wenn `reachable.length > 1` - identisch mit dem Brief's "wer nur die
Heimatwehr verwaltet, sieht keinen Wähler".

**Erststart ohne Parameter**: liest `localStorage`, falls vorhanden und noch erreichbar,
`router.replace` auf die entsprechenden Parameter (kanonische, teilbare URL herstellen); sonst
Fallback wie in `resolveAdminScope` beschrieben.

## 6. Einbindung Desktop + Mobile

- **Desktop**: `AdminSidebar` (bereits Server Component, berechnet schon `getAdminSidebarStatus`)
  ruft zusätzlich `getReachableScopes(user)` und rendert `GeltungsbereichSelector` oberhalb von
  `AdminSidebarNav` - exakt die im Brief geforderte Position ("sitzt über der
  Verwaltungsnavigation, nicht darin").
- **Mobile**: jede der 5 bestehenden `/admin/*`-Seiten (benutzer/drohnen/heimatfeuerwehr/email/
  status) ruft bereits selbst `<AdminMobileTabs items={getAdminNavItems(user)} />` auf (nicht das
  Layout - siehe CLAUDE.md "Phase 6"). `GeltungsbereichSelector` wird nach demselben,
  etablierten Ein-Zeilen-pro-Seite-Muster direkt darüber ergänzt, mit derselben
  `reachable`-Berechnung, die jede Seite ohnehin schon serverseitig durchführen kann.
- `admin/layout.tsx`s bestehendes Gate (`canAccessHeimatfeuerwehrAdmin(user) ||
  droneGroupRole === 'ADMIN' || isBezirksDrohnenAdmin`) bleibt unverändert - es ist bereits
  korrekt und unabhängig vom Geltungsbereich-Konzept.

## 7. Sicherheit

`getReachableScopes` ist die einzige Quelle dafür, was ein Benutzer sehen darf - baut ausschließlich
auf bereits etablierten `SessionUser`-Feldern (`isBezirksAdmin`, `abschnittAdminOrgIds`,
`feuerwehrAdminOrgIds`) auf, keine neue Rechteentscheidung. `resolveAdminScope` verwirft jeden
Parameter, der nicht in `reachable` vorkommt (kein Fallback auf "irgendeine andere Organisation").
Da in dieser Phase noch keine Liste nach dem Geltungsbereich filtert, gibt es noch keine
Daten-Leck-Fläche - die Funktion ist aber bereits so gebaut, dass Phase 3/4 sie direkt als
Sicherheitsgrenze wiederverwenden können, ohne sie umzubauen.

## 8. Umfang / Nicht-Ziele dieser Phase

- Keine Filterung bestehender Listen nach Geltungsbereich (Phase 3/4).
- Keine neuen Seiten (Abschnittsliste = Phase 5, Drohnengruppen-Liste/-Einsatzbereitschaft =
  Phase 6).
- Keine Änderung an `getAdminNavItems()`/der Nav-Item-Liste selbst - nur der neue Wähler wird
  ergänzt, die bestehenden Menüpunkte bleiben unverändert.
- Kein verschachteltes URL-Schema (`/admin/bezirk/17/…`) - explizite Nutzer-Entscheidung.

## 9. Abnahme

- Ein Bezirksadmin sieht den Wähler mit Bezirk + 7 Abschnitten + ~124 Feuerwehren, durchsuchbar.
- Ein Abschnittsadmin sieht seinen Abschnitt + seine Feuerwehren, keinen anderen Abschnitt.
- Ein Feuerwehr-Admin mit genau einer Heimatwehr sieht **keinen** Wähler.
- Ein Feuerwehr-Admin mit mehreren direkt verwalteten Feuerwehren sieht den Wähler mit genau
  diesen Feuerwehren.
- Eine Auswahl übersteht Reload und ist als Link teilbar (`?ebene=&org=` in der URL).
- Ein zweiter Besuch ohne Parameter übernimmt die zuletzt gewählte Ebene aus `localStorage`.
- `resolveAdminScope` weist jeden Parameter zurück, der nicht in der berechneten
  `reachable`-Liste vorkommt.
