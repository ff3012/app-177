# CLAUDE.md — Verwaltung (admin)

This file loads automatically (in addition to the root CLAUDE.md) when Claude Code works with files under this directory. Moved out of the root CLAUDE.md by a /doctor pass (context-size cleanup) — content is unchanged verbatim.

### Verwaltung (shadcn/ui-Grundlage)

Verwaltung wird laut `Verwaltung-Brief.md` (Claude Design) modul-für-modul auf shadcn/ui umgestellt — die
**erste UI-Bibliothek in dieser Codebase**, die sonst konsequent alles handrollt (`ToggleSwitch`,
`BottomSheet`, Inline-SVGs statt Icon-Library, Mailjet per rohem `fetch` statt SDK). Bewusste, dokumentierte
Ausnahme: Verwaltung braucht mehrere barrierefreiheitskritische Bausteine (fokus-fallenbehafteter Sheet,
DropdownMenu, AlertDialog), bei denen Radix' geprüfte Fokus-/ARIA-/Tastatur-Logik einem Handbau vorzuziehen
ist. Es existieren dadurch dauerhaft zwei Komponenten-Philosophien nebeneinander (Verwaltung=shadcn, Rest der
App=handgerollt) — kein Versehen, kein geplanter Umbau des restlichen Codes auf shadcn.

- **Tailwind-Versions-Stolperstein**: `npx shadcn@latest` (aktuell v4.16) generiert standardmäßig für
  Tailwind v4 (`@import "tw-animate-css"`/`@import "shadcn/tailwind.css"` in CSS, `oklch()`-Farben, kein
  `tailwind.config.ts`-Eintrag) — dieses Projekt läuft aber auf Tailwind v3.4.17. Die CLI-generierten
  globals.css-/tailwind.config.ts-Änderungen wurden deshalb verworfen und **von Hand** durch die klassische
  v3-taugliche Variante ersetzt: CSS-Variablen mit fertigen Hex-Werten direkt in `globals.css`'s zweitem
  `:root`-Block (eigene Namen wie `--surface`/`--ink`/`--brand-hover`, bewusst NICHT `--background`/
  `--foreground` wiederverwendet, da diese beiden Namen bereits app-weit das `<body>`-Hintergrund/-Textfarbe
  aus dem ursprünglichen "Signalrot"-Pass tragen), plus die passenden `theme.extend.colors`-Einträge in
  `tailwind.config.ts` (sowohl die Brief-eigenen Tokens `ink`/`line`/`surface`/`success`/`warning`/`danger`
  als auch die von generierten shadcn-Komponenten erwarteten Alias-Namen `background`/`foreground`/`card`/
  `popover`/`primary`/`secondary`/`muted`/`accent`/`destructive`/`border`/`input`/`ring` — beide Gruppen
  zeigen auf dieselben CSS-Variablen, nicht doppelt gepflegt). `tw-animate-css` (v4-only) wurde durch
  `tailwindcss-animate` (v3-kompatibel, in `plugins: []` registriert) ersetzt; `shadcn`/`radix-ui`-Pakete
  wurden dabei nicht durch eigene Einzelpakete ersetzt, da `radix-ui` selbst schon das aktuelle, gebündelte
  Radix-Meta-Package ist (kein v4-spezifisches Detail, sondern nur die neuere Verpackung vieler
  `@radix-ui/react-*`-Pakete in einem). `darkMode: 'class'` wurde explizit gesetzt (statt Tailwinds Default
  `'media'`), obwohl nirgends eine `.dark`-Klasse gesetzt wird — sonst würden `dark:`-Varianten in
  generiertem shadcn-Code (kommen vereinzelt vor, z. B. im Button) auf `prefers-color-scheme: dark`
  reagieren, obwohl die App bewusst fixed-light ist (`color-scheme: light`, kein Theme-Umschalter). Ein paar
  rein kosmetische v4-only-Utility-Klassen in generierten Komponentendateien (z. B. `origin-(--radix-...)`,
  `**:`-Descendant-Variant in `tooltip.tsx`) erzeugen unter v3 einfach keine zusätzliche Regel (kein Build-
  Fehler, nur ein minimal weniger präziser Animations-Ursprung) — bewusst nicht einzeln von Hand gepatcht,
  da der Aufwand den kosmetischen Nutzen nicht rechtfertigt.
- **Echter Bug aus derselben Ursache, nicht nur kosmetisch (gefunden nach einem Nutzerbericht: "Aktiv"-
  Switch und Drohnengruppe-RadioGroup in `UserFormSheet` ließen sich optisch nicht auswählen)**: Tailwind v4
  führt automatisch generierte, klammerlose `data-*:`-Varianten für JEDEN beliebigen Data-Attribut-Namen ein
  (`data-checked:`, `data-open:`, `data-active:`, …, matcht `[data-x]`-Präsenz) — Tailwind v3.4.19 kennt diese
  Kurzform nicht (nur die Klammer-Syntax `data-[attr]:`/`data-[attr=wert]:` funktioniert, empirisch mit
  `npx tailwindcss -i ... --config tailwind.config.ts` gegen ein Test-HTML verifiziert: `data-checked:` und
  `data-[state=checked]:` sehen im generierten Code gleich harmlos aus, aber nur letzteres erzeugt tatsächlich
  eine CSS-Regel). Der von `npx shadcn add` generierte Code verwendet diese v4-Kurzform großflächig für
  Radix' `data-state`/`data-orientation`/`data-disabled`-Attribute — unter v3 blieben dadurch `Switch`,
  `RadioGroup` und `Checkbox` (`data-checked:bg-primary` etc.) **optisch dauerhaft im "nicht ausgewählt"-
  Zustand eingefroren**, unabhängig davon, ob der zugrunde liegende Radix-/react-hook-form-Zustand beim Klick
  korrekt umschaltete — ein Nutzer, der klickt und keine visuelle Reaktion sieht, empfindet das zu Recht als
  "kann nicht ausgewählt werden". Jede betroffene Datei wurde anhand des tatsächlich von der installierten
  `@radix-ui/react-*`-Version gesetzten Attributs korrigiert (per `grep` in `node_modules/@radix-ui/react-*/
  dist/index.mjs` verifiziert, nicht geraten): `switch.tsx` (`data-[state=checked]`/`data-[state=unchecked]`/
  `data-[disabled]`), `radio-group.tsx`/`checkbox.tsx` (`data-[state=checked]`), `select.tsx`
  (`data-[placeholder]`/`data-[disabled]`), `separator.tsx`/`tabs.tsx` (`data-[orientation=horizontal|
  vertical]`, `tabs.tsx` zusätzlich `data-[state=active]` — Tabs selbst wird aktuell nirgends im Code
  verwendet, aber derselbe Fehler wurde vorsorglich behoben, bevor die Komponente je in Gebrauch kommt).
  Zusätzlich (rein kosmetisch, keine Funktionseinbuße, da Radix Öffnen/Schließen ohnehin selbst steuert, nur
  bislang ohne Ein-/Ausblend-Animation): dieselbe Korrektur (`data-open:`/`data-closed:` →
  `data-[state=open]:`/`data-[state=closed]:`) in `dialog.tsx`, `sheet.tsx`, `alert-dialog.tsx`,
  `dropdown-menu.tsx` (dort zusätzlich `data-inset:` → `data-[inset=true]:`, ein von der Komponente selbst
  gesetztes, nicht Radix-generiertes Attribut) und `tooltip.tsx` (`data-open:` entspricht dort dem von Radix
  Tooltip gesetzten `data-state="instant-open"`, nicht `"open"` — ebenfalls am tatsächlichen Paket-Quellcode
  verifiziert statt angenommen). Ein `grep -noE "data-[a-z-]+:" src/components/ui/*.tsx | grep -v "data-\["`
  über den gesamten Ordner findet danach keine bare Variante mehr — die Suche nach zukünftig neu
  hinzugefügten shadcn-Komponenten sollte denselben Check vor dem Commit wiederholen.
- **Weiterer echter Bug aus derselben v3/v4-Ursache (gefunden nach einem Nutzerbericht: "Dienstgrade-Dropdown
  kann nicht ausgewählt werden")**: `npx shadcn add` generiert für Radix-Popup-Inhalte (`select.tsx`,
  `dropdown-menu.tsx`, `popover.tsx`, `tooltip.tsx`) Klassen wie `max-h-(--radix-select-content-available-height)`
  und `origin-(--radix-select-content-transform-origin)` — Tailwind **v4**s neue Kurzform, eine CSS-Variable
  direkt in runden statt eckigen Klammern zu referenzieren, ohne `var(...)`. Tailwind v3.4.19 kennt diese
  Syntax nicht; empirisch mit `npx tailwindcss -i ... --config tailwind.config.ts` gegen ein Test-HTML
  verifiziert (derselbe Verifikationsweg wie beim `data-checked:`-Fund oben): die Klasse erzeugt unter v3
  **gar keine Regel**, `max-height`/`transform-origin`/`width`/`height`/`min-width` bleiben unbounded/unset.
  Bei den meisten Radix-Popups (wenige Einträge, z. B. Rolle/Status-Filter oder das Row-Actions-Dropdown)
  blieb das unbemerkt, weil der Inhalt ohnehin in den Viewport passt — bei der 46-Einträge-Dienstgradliste
  im `UserFormSheet` sprengte das fehlende `max-height`/`overflow-y-auto`-Zusammenspiel jedoch die
  Panelgröße: das Dropdown öffnete sich (Radix rendert den Portal-Inhalt clientseitig ungeachtet der
  fehlenden CSS-Regel), aber ohne Höhenbegrenzung/Scroll ragte ein Großteil der Liste außerhalb des
  sichtbaren Viewports und war damit faktisch nicht anklickbar — genau das gemeldete Symptom. Gefixt durch
  Ersetzen der v4-Kurzform durch die v3-taugliche Arbitrary-Value-Syntax mit explizitem `var(...)`
  (`max-h-[var(--radix-select-content-available-height)]` etc.) an allen 6 betroffenen Stellen in den 4
  genannten Dateien — vorher/nachher per Tailwind-CLI-Kompilierung gegenübergestellt (Regel fehlte komplett →
  erzeugt jetzt `max-height: var(--radix-select-content-available-height)` korrekt). Da dieses
  Browser-Automatisierungs-Sandbox React clientseitig nie hydratisiert (derselbe bereits dokumentierte,
  session-übergreifende Befund — `__reactFiber$`-Lookup findet nirgends etwas, auch nicht nach direkter
  `?edit=<id>`-Navigation), war ein echtes Klick-Nachstellen des Dropdowns hier nicht möglich; die Behebung
  stützt sich stattdessen vollständig auf die empirische Tailwind-Kompilierungsprüfung, nicht auf einen
  Browser-Repro. `outline-hidden` (select.tsx/popover.tsx) und `not-data-[variant=destructive]:focus:**:...`
  (select.tsx, `**:`-Deszendenten-Variante) sind ebenfalls v4-only und erzeugen ebenso keine Regel, wurden
  aber bewusst **nicht** angefasst — rein kosmetisch (Fokus-Outline bzw. Fokus-Textfarbe), exakt dieselbe
  Abwägung wie beim ursprünglichen `tooltip.tsx`-Fund weiter oben.
- `tailwind.config.ts` braucht `import tailwindcssAnimate from 'tailwindcss-animate'` statt
  `require('tailwindcss-animate')` im `plugins`-Array — dieses Next-15-Setup lädt `tailwind.config.ts` in
  einem Kontext, in dem `require` zur Laufzeit nicht definiert ist (`ReferenceError: require is not defined`),
  nur `import`/ESM funktioniert.
- shadcn-Komponenten installiert (in `src/components/ui/`, eigene Dateinamen, keine Kollision mit den
  bestehenden Handbau-Dateien dort): `table`, `badge`, `button`, `input`, `select`, `switch`, `dialog`,
  `sheet`, `dropdown-menu`, `tabs`, `tooltip`, `skeleton`, `alert-dialog`, `separator`, `checkbox`,
  `popover`, `command` (+ dessen Abhängigkeiten `input-group`/`textarea`, aktuell ungenutzt aber von der
  CLI mitgeneriert). `command` bringt `cmdk` als neue Abhängigkeit mit - für "Admin für" in
  `UserFormSheet` (siehe Benutzerverwaltung-Brief.md unten). Dieselbe v3-Inkompatibilität wie beim
  ursprünglichen Verwaltung-Umbau trat erneut auf (`data-open:`/`data-closed:` in `popover.tsx`,
  `data-selected:` in `command.tsx` - jeweils per `grep` gegen `node_modules/@radix-ui/react-popover`/
  `node_modules/cmdk` auf den tatsächlich gesetzten Attributwert verifiziert, nicht geraten - Radix setzt
  `data-state="open"|"closed"`, cmdk setzt `data-selected="true"|"false"` als String, nicht als reine
  Präsenz), auf dieselbe Art gefixt (`data-[state=open]:` etc., `data-[selected=true]:`). Ein paar weitere
  rein kosmetische v4-only-Utility-Klassen in diesen beiden neuen Dateien (`rounded-xl!`,
  `*:data-[slot=...]:pl-2!`, `**:[[cmdk-group-heading]]:...`) wurden bewusst NICHT gepatcht - exakt
  dieselbe Abwägung wie beim ursprünglichen `tooltip.tsx`-Fall: sie erzeugen unter v3 einfach keine
  zusätzliche Regel, kein Build-Fehler, nur eine minimal weniger präzise Ecke/Innenabstand.
  `sonner` (Toast) wurde bewusst NICHT über `npx shadcn add sonner` (das nur einen dünnen
  Wrapper generiert) hinzugefügt, sondern das rohe `sonner`-Package direkt in `(app)/layout.tsx` als
  `<Toaster theme="light" position="top-right" richColors />` eingehängt. `TooltipProvider`
  (`components/ui/tooltip.tsx`) wrappt ebenfalls in `(app)/layout.tsx`, wie von der CLI selbst verlangt.
- Barlow Condensed (`--font-barlow-condensed`, `font-condensed`) neu in `src/app/layout.tsx`/
  `tailwind.config.ts` ergänzt, ausschließlich für Kennzahlen (Mitgliederzahl-Kacheln) laut Brief — nicht als
  allgemeine Schriftfamilie, Barlow bleibt der Fließtext-Font app-weit.

### Verwaltung (admin) navigation

> **Superseded in part by the Bezirk hierarchy** — `admin/layout.tsx`'s gate is no longer `isSiteAdmin`-only
> (that function no longer exists; the equivalent right is now `isBezirksAdmin`). It admits Bezirksadmins,
> Abschnittsadmins, Feuerwehr-Admins **and** pure Drohnengruppen-Admins, so it proves almost nothing on its
> own and every page/action must check for itself. See "Bezirk / Abschnitt / Feuerwehr hierarchy" above.
> The Phase 2–7 narrative below is kept as history; read `isSiteAdmin` in it as `isBezirksAdmin`.

**Phase 2 (Verwaltung-Brief.md)**: `src/app/(app)/admin/layout.tsx` now gates all `/admin/*` pages centrally
(`requireUser()` + `notFound()` if `!isSiteAdmin(user)`) instead of each page independently returning a plain
"nur für die Abschnittskommando-Verwaltung sichtbar" fallback — a non-admin now gets a real 404, not an empty
page with friendly text. This only protects the page **render**; the pre-existing `assertPermission(
isSiteAdmin(...))` calls inside every admin Server Action (13 call sites, unchanged) still do the actual
authorization work, since a layout can't stop a Server Action invoked directly. The old horizontal pill nav
(formerly `components/layout/admin-nav.tsx`, `AdminNav`) is replaced by a fixed 210px-left-sidebar
(`components/admin/admin-sidebar.tsx` + `admin-sidebar-nav.tsx`, `md:` and up only — mobile gets its own
tabs-based nav, see Phase 6/7 below) rendered once by the layout, not per-page. `AdminNav` was intentionally
**left in place but unused** through Phases 2–6 to avoid a half-migrated state where some pages had a sidebar
and others still rendered the old pill row; it was deleted for good in Phase 7 once every admin page had its
own replacement nav (`AdminSidebar`/`AdminMobileTabs`) — `grep -rn "AdminNav"` now returns no functional
references, only the historical mentions in this file.
`AdminSidebar` additionally shows a 3-row status summary (Datenbank/Mailjet/Zeitserver, click → `/admin/status`)
via a new `getAdminSidebarStatus()` in `lib/system/system-check.ts` — a subset of 3 of the 8
`getSystemCheckResult()` signals, wrapped in `unstable_cache(..., { revalidate: 60 })` since the sidebar
renders on every single admin page navigation; without the cache, every click within Verwaltung would
trigger a live DB query + Mailjet API call + external NTP fetch just to paint three status dots.
**Updated since "Meine Feuerwehr" (Module 4, see below)**: the shared layout's gate is no longer
`isSiteAdmin`-only — it also lets in any Feuerwehr-Admin — so a new Site-Admin-only page can no longer rely
solely on that gate and must add its own `if (!isSiteAdmin(user)) notFound()`, same as the four original
pages now do. `AdminSidebarNav`/`AdminMobileTabs`'s `ITEMS` are also no longer a static array — add a new
page by (1) adding the explicit `isSiteAdmin` check (or the relevant permission check, if it should also be
reachable by Feuerwehr-Admins) to the page itself, (2) adding one entry to `getAdminNavItems()` in
`src/lib/admin/nav-items.ts`, gated by whichever permission function fits.

**Phase 3 (Benutzertabelle)**: `user-management-section.tsx` was rewritten on shadcn `Table`/`Badge`/
`DropdownMenu`/`AlertDialog`/`Checkbox`/`Select`/`Input`. Filter/sort state (`q`/`feuerwehr`/`rolle`/`status`/
`sort`/`dir`) is mirrored into the URL via `router.replace(..., { scroll: false })` — the **first use of
URL-synced state in this codebase** — but stays a pure bookmark/share mechanism: filtering/sorting itself is
still entirely client-side `useMemo` over the one server-fetched `UserRow[]` array (184 rows doesn't justify
server-side filtering or a network round-trip per keystroke), the URL is just kept in sync with whatever the
client already computed. The search input debounces 300ms before updating both the filter and the URL;
selects/sort update immediately. `UserRow` gained `homeOrganizationId`/`isAdmin`/`isActive` (raw values, not
just their display strings) specifically so filters can match reliably instead of comparing rendered text.
`name` is now built as `"${lastName} ${firstName}"` (brief's "Nachname Vorname"), a real behavior change from
the previous "Vorname Nachname" order. Two new, deliberately thin server actions
(`bulkSetActive`/`bulkSetHomeOrganization` in `actions.ts`) back the new multi-select action bar — the brief's
own "don't reinvent Server Actions" instruction was about not touching `createUser`/`updateUser`/`deleteUser`,
not a prohibition on adding new ones the existing UI never needed; both call `prisma.updateMany` directly
rather than looping the full `userSchema` validation, since a boolean toggle / org reassignment across many
rows needs no per-row form validation. `setUserActive` (also new) is the same pattern for the single-row
"Aktivieren/Deaktivieren" menu item — the old UI only ever toggled this via the full edit form's checkbox.
Row-level actions live in a new `user-row-actions.tsx` (`DropdownMenu` + `AlertDialog`), reusing
`deleteUser`/`sendPasswordResetEmailToUser` unchanged — `deleteUser` is called directly (not via a
`<form action>`) inside `startTransition`, same pattern `UserForm` already used for `createUser`/`updateUser`;
Next's Server Action redirect handling works identically either way. Clicking "Bearbeiten" (or a table row)
still navigates to the existing `/admin/benutzer/[userId]` page — Phase 4 turns that into a `Sheet` opened
in place; this phase deliberately didn't touch that yet. Push is now a live count + `title` tooltip listing
each `PushSubscription.createdAt` (`"Registriert seit ..."` per device) — there's no device-name field in the
schema to show a real "Gerätename" as the brief's wording literally suggests, so the tooltip shows dates only,
not a fabricated device label.

**Phase 4 (Detail-Sheet)**: `createUser`/`updateUser`'s form moved from two dedicated pages
(`/admin/benutzer/neu`, `/admin/benutzer/[userId]`) into `components/admin/user-form-sheet.tsx`
(`UserFormSheet`) — a shadcn `Sheet` (`side="right"`, `sm:max-w-[520px]`) opened directly from the table
(row click, a row's "Bearbeiten" menu item, or the "Neuer Benutzer" button), with four single-column sections
(Person/Zugang/Zuordnung/Drohnengruppe) replacing the old two-column grid — "die Feldlängen sind zu
unterschiedlich" per the brief. Both old routes **still exist and stay valid deep links** (e.g. a bookmarked
edit URL) but now just `redirect()` to `/admin/benutzer?edit=<id>` / `?new=1`; `UserManagementSection` reads
those two params once (lazy `useState` initializer) to open the sheet pre-populated, then its existing
filter-sync effect naturally strips them back out of the URL on the next render (they were never part of that
effect's own tracked param set). This meant extending `UserRow` with raw fields the display columns didn't
need (`firstName`/`lastName` separately, `adminOrgIds: string[]`, `droneRole`) so opening the sheet for any
row never needs a second server round-trip — the table already fetched everything. The old
`delete-user-button.tsx`/`password-reset-email-button.tsx`/`components/admin/user-form.tsx` are gone entirely
(superseded by `user-row-actions.tsx` and `UserFormSheet`, not kept as unused fallbacks — unlike `AdminNav`,
which stays until step 7 specifically because deleting it now would strand three still-unmigrated pages).
Closing the sheet with unsaved changes shows a shadcn `AlertDialog` ("Änderungen verwerfen?") instead of
`window.confirm()` — implemented by keeping `open` fully controlled by the parent and simply not propagating
a close request through when `formState.isDirty` is true, showing the confirm dialog instead; confirming
sets the real `open=false`. The "no welcome email → show the activation link to copy" flow (unchanged
behavior, just relocated) now swaps the sheet's body to that panel instead of navigating to a fresh page.
`createUser`/`updateUser` still call `redirect('/admin/benutzer')` on success internally, unchanged — called
directly from the client (not a `<form action>`) inside `startTransition`, the same pattern already used
before this phase and still works identically.

**Bugfix (GitHub issue #7, found after Phase 7)**: this single-shared-Sheet design had a real regression
Phase 4 introduced and never caught — `UserFormSheet` is one always-mounted component instance (unlike the
old `UserForm`, which got a fresh page mount, and therefore a fresh `useForm()` call, on every single edit).
`react-hook-form`'s `defaultValues` are only read once, on the very first `useForm()` call for a given
component instance; changing the `target` prop on later renders does **not** update the already-registered
input values. In practice this meant every row you clicked after the first one opened a Sheet still showing
whichever user's data happened to populate it first — reported as "only admin@abschnitt-purkersdorf.at is
showing, can't select another user to edit." Fixed by extracting `buildDefaultValues(target, mode,
organizations)` and calling `reset(buildDefaultValues(...))` in a `useEffect` keyed on
`[open, target?.id, mode]` — i.e. every time the sheet is freshly opened for a (possibly different) target,
not just once at mount. While fixing this, also caught and fixed a real `isActive` default bug in the same
object literal: `target?.isActive ?? mode === 'create' ? false : true` — `??` binds tighter than `? :`, so
this parsed as `(target?.isActive ?? (mode === 'create')) ? false : true`, which inverted the "Zugang aktiv"
toggle's default for every edit (a deactivated user's edit sheet defaulted the toggle to *on*, and vice
versa) regardless of the stale-defaultValues bug above. Fixed with explicit precedence:
`target ? target.isActive : mode === 'create' ? false : true`.

**Phase 5 (Lade-/Leer-/Fehlerzustände)**: most of this phase's asks were already satisfied incidentally by
earlier phases (the "leer nach Filterung" message + "Filter zurücksetzen" button from Phase 3; specific,
non-generic `toast.error(...)` text throughout Phase 3/4's row/bulk/sheet actions, never a bare "Fehler").
What was actually new: `src/app/(app)/admin/benutzer/loading.tsx` — Next's App Router Suspense-fallback
convention, shown automatically both on first page load and on the `router.refresh()` calls Phase 3's bulk
actions already trigger, six `Skeleton` rows in table form as the brief specifies (no spinner) — this file
needs no data since it's a pure static shell shown *before* `page.tsx`'s data arrives. `user-management-
section.tsx`'s single empty-state branch was split into two: `users.length === 0` ("Noch keine Benutzer
angelegt" + Excel-Import as the primary action) is now distinct from `sorted.length === 0` ("Keine Benutzer
entsprechen den Filtern" + "Filter zurücksetzen") — the brief treats these as two different states with
different primary actions, the old code collapsed them into one message. `UserFormSheet`'s save button also
got an actual spinner icon (inline SVG, `animate-spin`, matching this codebase's hand-rolled-icon convention)
next to its "Speichern…" text while pending — the brief's "kein Spinner" rule is specifically about the
list's own loading state (a static skeleton reads calmer for a whole-page wait), not the save button, which
it explicitly asks to show one for.

**Phase 6 (Mobile Verwaltung)** — introduced a **second breakpoint reconciliation** within this module:
Phases 2's sidebar already switched at `md:` (768px, matching the brief's own "< 768px" heading literally,
unlike Kalender/Drohnengruppe's `sm:`/`lg:` elsewhere in the app), but Phase 3's table/card switch had been
built at the app-wide `sm:` (640px) default — leaving an inconsistent 640–767px gap where the sidebar was
already gone (`md:`-gated) but the desktop table was still showing (`sm:`-gated), with no navigation at all
in that range. Fixed by moving every "mobile shell vs desktop shell" class in
`user-management-section.tsx` from `sm:` to `md:` (a plain find/replace, confirmed by grep beforehand that
no other `sm:` usage in that file needed to stay — the column-density `xl:` breakpoint for
email/Drohnengruppe/Push is untouched, that's a separate concern). `components/admin/admin-mobile-tabs.tsx`
(new) is a horizontal-scroll pill nav, deliberately a **separate component** from `AdminSidebarNav` rather
than a shared one — same `ITEMS` list duplicated once, but the visual language (pills vs. sidebar rows) is
different enough that sharing would need conditional rendering internally; rendered directly inside
`UserManagementSection` right after its own title (not in `admin/layout.tsx`) since "unter dem Titel" only
makes structural sense from inside the page that owns that title — Phase 7 adds the same one-line call to
the other three pages once they get real titles.

The desktop-only Select filter row (`hidden md:flex`) and the search `Input` (always visible - "Inhalt
zuerst" the same way Kalender's mobile filter sheet keeps its segmented control inline) were split apart;
the row's JSX became a `filterControls` local variable (not a separate component with props - it closes over
the same `feuerwehr`/`rolle`/`status`/`organizations` state already in scope) reused verbatim inside a new
`Sheet side="bottom"` triggered by a filter icon registered into `MobileHeaderContext`'s action slot via
`useEffect` — the exact same slot Kalender's own mobile filter button already uses (only one page is ever
mounted at a time, so there's no conflict). `UserFormSheet`'s width override needed the same
`data-[side=right]:` variant prefix as shadcn's own generated classes (`data-[side=right]:w-full
data-[side=right]:sm:max-w-none data-[side=right]:md:w-[520px] data-[side=right]:md:max-w-[520px]`) to
reliably win the `cn()`/tailwind-merge conflict resolution against the component's built-in `w-3/4`/`sm:max-w-sm`
— a bare `sm:max-w-[520px]` (what Phase 4 originally shipped) left the sheet at 75% width below `sm:` and a
384px cap in the 640–767 gap, neither of which is the "Vollbild-Sheet" the brief asks for on mobile.

Verification note: unlike Phases 3-5, this phase's core claim (responsive layout switching four different
`hidden md:*`/`md:hidden` pairs correctly) is CSS-driven and doesn't depend on the hydration that's confirmed
broken in this browser-automation environment — verified directly via `getComputedStyle(...).display` at
390px and 1024px viewports against a real logged-in session, confirming all of: sidebar ↔ tabs,
table ↔ card-list, desktop filter row ↔ hidden, stat cards ↔ hidden, fixed CTA ↔ header button, each showing
the correct side at the correct width, plus the card's exact rendered text ("Admin Abschnitt" · "Aktiv" ·
"Purkersdorf · Admin") and its `min-height: 44px` tap target. What remains unverifiable for the same
already-documented reason: the mobile header's filter-icon `useEffect` registration never fires (confirmed
absent from the DOM at 390px), and the Sheet/bottom-sheet's actual open/close interaction — both depend on
client-side effects that don't run when hydration doesn't attach, exactly like Phase 4's detail sheet.

Verification note: this browser-automation environment does not hydrate client-side React on this page at
all in the current session (confirmed via `__reactFiber$`/`__reactContainer$` lookups on `document.body`
finding none, even after waiting) — the same harness-wide gap already documented for Mobile-Brief.md, now
additionally confirmed to block Radix Portal-based content (`Sheet`/`Dialog`/`DropdownMenu`/`Select`) from
ever mounting in a static DOM snapshot here, regardless of the underlying React state's correctness, since
portal content only exists post-hydration. Directly submitted `<form>` elements (e.g. login) still work since
those are native browser submissions Next progressively enhances, not pure client reactivity. What *was*
verified: both old routes correctly `redirect()` to the new query-param URLs (confirmed via
`window.location.href` after navigating), the resulting pages return 200 with all JS chunks loading
successfully and zero console errors, and (Phase 3) filtering/sorting/chip/empty-state logic via direct URL
query params against seeded data. The `Sheet`'s actual open/close/submit/discard-confirm interaction could
not be exercised end-to-end in this environment — flagged transparently rather than claimed as tested.

**Phase 7 (Drohnengruppe/E-Mail/Status + `AdminNav`-Löschung)** — the final phase, bringing the three
remaining `/admin/*` pages onto the same shadcn/`AdminMobileTabs`/`getComputedStyle`-verified foundation as
`/admin/benutzer`, and removing the now fully superseded `AdminNav`. Purely a surface rebuild — no Server
Action logic changed on any of the three pages.

- **`/admin/drohnen`**: gained a page title, `<AdminMobileTabs/>`, and its drone table restyled onto shadcn
  `Table`/`Badge` (`RenameDroneForm`/`toggleDroneActive` untouched). Originally also gained a
  "Mitglieder · 90-Tage-Status" section here (`listDrohnengruppeMembers()` +
  `getNinetyDayCutoff()`/`meetsNinetyDayRule()` + a `prisma.droneFlight.groupBy`, rendered as a binary
  Erfüllt/Offen `Table`/`Badge` with each row linking to `/admin/benutzer?edit=<id>`), gated on
  `canViewAllFlights(user)` in addition to the page's own `isSiteAdmin` gate — **this section no longer
  exists**: commit `6ac93d1` removed it in favor of a link to the dedicated
  `/admin/drohnen/einsatzbereitschaft` page (see "Einsatzbereitschaft (Drohnengruppe)" under the
  Drohnengruppe module section above), which supersedes it with a BOS1-aware, three-state Ampel instead of
  a binary badge. The QR-code and Unterlagen cards were restyled onto `bg-surface`/`shadow-card` tokens
  with no functional change.
- **`/admin/email`**: gained a title + `<AdminMobileTabs/>`; its three cards (`DroneFlightEmailForm`/
  `SystemCheckEmailForm`/`TestMailjetForm`, internals untouched) now sit in a `max-w-[640px]` single column
  per the brief's explicit "nicht über die volle Fensterbreite gezogen" — confirmed via
  `getComputedStyle(...).maxWidth === '640px'` against the live page, deliberately narrower than the
  full-width table pages since this page is only ever short, one-line forms.
- **`/admin/status`**: `SystemCheckPanel` rewritten from colored-dot cards to a single bordered list —
  label left, a small status dot + the same `row.detail` value in `font-mono` right, one "Zuletzt geprüft"
  timestamp underneath the whole list (not per-row, since several rows' own `detail` text already embeds a
  timestamp) — and rows are now sorted failing-first (`Number(a.ok) - Number(b.ok)`, stable so same-status
  rows keep `buildSystemCheckRows`' original order). `runSystemCheck()`/`buildSystemCheckRows()` themselves
  are unchanged, only the presentation. The "Jetzt prüfen" click itself could not be exercised end-to-end in
  this browser-automation session — clicking produced no network request, consistent with the
  already-documented hydration gap above (`onClick` handlers don't fire when React never attaches), not a
  regression in this phase's code.
- `AdminNav` (`src/components/layout/admin-nav.tsx`) is **deleted** — confirmed via `grep -rn "AdminNav"`
  that no functional references remained (only this file's own historical prose mentions it), now that every
  `/admin/*` page has its own `AdminSidebar`/`AdminMobileTabs` nav. This closes out the Verwaltung-Brief.md
  7-phase plan.

- `/admin/benutzer` — `UserManagementSection` (client) owns free-text search and click-to-sort-any-column
  over a flat `UserRow[]` the server maps the Prisma result into; don't push search/sort server-side, ~200
  users is small enough to do it in the browser. The "Willkommen-E-Mail senden" toggle (default on, now inside
  `UserFormSheet`'s create mode) still creates the user + activation token either way — turning it off just
  skips `sendActivationEmail` and instead swaps the sheet's body to show the activation link (with a copy
  button) for the admin to hand over manually; there's no way today to retrieve that link again afterward if
  the admin closes the sheet without copying it (the admin-triggered password-reset email is a separate,
  unrelated flow for existing users, not a way to recover this). `User.stbNr`/`User.phone` (Standesbuchnummer,
  E.164 phone) are plain fields with no DB-level uniqueness — `phone` is only format-validated
  (`E164_PHONE_REGEX` in `lib/validation/user.schema.ts`), and create mode pre-fills `+43` as a starting point
  (edit mode leaves it untouched). **GitHub issue #12**: `stbNr` is now mandatory — enforced in
  `userSchema` (`.min(1, ...)`, was `.optional().or(z.literal(''))`) and in the Excel bulk import's
  own required-fields check, both **application-level only**; the DB column stays `String?` (nullable),
  since tightening it to `NOT NULL` would need a backfill value for any already-existing user with no
  StbNr, and there's no honest value to backfill with — same "nullable column, form-enforced required"
  precedent as `VehicleBooking.details`.
- **GitHub issue #13**: the Heimat-Feuerwehr field in `UserFormSheet` is a searchable combobox
  (`src/components/admin/org-search-select.tsx`'s `OrgSearchSelect`, `id="homeOrganizationId"
  triggerClassName="w-full"`), not a plain `<Select>` — with up to 124 Feuerwehren in a Bezirksadmin's
  list, a flat dropdown had no way to filter by typing. This reuses the exact same component the
  Abschnitt-/Feuerwehr-**filters** in `user-management-section.tsx` already used (see
  "Geltungsbereich-Wähler" below) rather than building a new one; `OrgSearchSelect`'s own `allLabel`
  prop had to become **optional** for this (`allLabel?: string`) — the two filter call sites still pass
  it (they need an "Alle Feuerwehren" entry, since "no selection" means "no filter" there), but
  Heimat-Feuerwehr is a mandatory field with no "Alle" concept, so its own call site omits `allLabel`
  entirely and the component simply skips rendering that list entry. Also added `id`/`triggerClassName`
  props (both optional, unused by the two pre-existing filter call sites) so the form's `FieldLabel`
  still associates correctly and the trigger can stretch to the form's full field width.
- **Excel export/import** (`/admin/benutzer/export`, `/admin/benutzer/import`): both read/write the same
  column set from `lib/admin/user-excel-columns.ts` (`USER_EXCEL_COLUMNS`) — the export is deliberately also
  the import template (same header names), so re-uploading an unmodified export works without edits. Export
  includes active *and* deactivated users (no `isActive` filter). Import matches
  existing users by **StbNr + Heimat-Feuerwehr** (not email) to decide what's a duplicate to skip vs. a new
  row to create; header names are resolved from row 1 rather than assumed to be in a fixed column order.
  Rows are processed independently (one bad row records an error message and moves on, doesn't abort the
  batch). A single "Willkommen-E-Mail senden" Ja/Nein select applies to the whole batch (default Ja) —
  when Nein, `importUsers` still creates every user and its `PasswordToken` as normal but skips
  `sendActivationEmail` and instead collects `{name, email, link}` per created user, returned to the client
  and rendered as a list of activation links with copy buttons (same `CopyLinkButton`/link-expiry pattern as
  the single-user form's own Nein path) — there's no per-row toggle, only one setting for the entire upload.
  **GitHub issue #11 ("auf alle Benutzerfelder erweitern")**: originally `Admin für`/`Drohnengruppe`/
  `Status` were export-only (`USER_IMPORT_COLUMN_KEYS` was a strict subset of `USER_EXCEL_COLUMNS`'
  keys) and several fields (Dienstgrad, Atemschutzgeräteträger, the five Ausbildungsstufen dates,
  Bezirksadmin, Bezirks-Drohnenadmin) weren't represented in Excel at all. Both directions now cover
  every `UserFormSheet` field except `Status` (a derived display value via `getUserStatus()`, not a
  raw settable field — still export-only, correctly absent from `USER_IMPORT_COLUMN_KEYS`):
  - `Drohnengruppe` (group name) and `Drohnengruppen-Rolle` (`DRONE_ROLE_LABEL`: Kein/Mitglied/Admin)
    are now two separate columns — the old single `droneRole`-keyed "Drohnengruppe" column showed only
    the role ("Admin"/"Mitglied"/""), never which of the (now four, post-Bezirk-expansion) groups, a
    real ambiguity this split resolves.
  - The five Ausbildungsstufen date columns are written/read as **ISO `YYYY-MM-DD`**, deliberately
    *not* the `de-AT` display format other export-only date columns use elsewhere (e.g.
    `atemschutz-excel-columns.ts`'s `toLocaleDateString('de-AT')`) — only ISO round-trips losslessly
    through `new Date(...)` on re-import; `"15.1.2025"` is not a valid `Date` constructor input and
    would silently become `Invalid Date`.
  - `findAusbildungsGapError()` (`import/actions.ts`) re-implements userSchema's own sequential-prefix
    invariant (a stage may only be set if every prior stage is too) standalone, since the bulk import
    bypasses `userSchema` entirely — without it, a row could set e.g. BOS1 without A1/A3 and violate an
    invariant every other part of the app assumes holds.
  - **Admin-rechte-relevante Felder (Bezirksadmin, Bezirks-Drohnenadmin, Admin für) sind bewusst auch
    per Bulk-Import setzbar** — eine explizite Entscheidung des App-Betreibers (per AskUserQuestion
    bestätigt) über die sicherere Alternative (nur Export). `importUsers` ist bereits oben auf
    `isBezirksAdmin` gegated, wofür `canGrantBezirksAdmin`/`canGrantBezirksDrohnenAdmin`
    (`permissions.ts`) ohnehin unconditionally `true` sind — deshalb schreibt der Bulk-Import diese
    Felder direkt per Prisma, ohne die granularen Pro-Zeile-Prüfungen aus `actions.ts`
    (`canGrantAdminFor`/`syncDroneMembership`'s eigene `canManageDroneGroupFor`-Checks) zu wiederholen.
  - Verifiziert end-to-end gegen die echte Server Action (nicht nur typgeprüft): ein echter Login über
    den Auth.js-`/api/auth/callback/credentials`-Endpunkt, danach ein echter multipart-Form-POST an
    `/admin/benutzer/import` über Next.js' No-JS-Progressive-Enhancement-Pfad für Server Actions (der
    `$ACTION_ID_.../$ACTION_REF_.../$ACTION_KEY`-Hidden-Field-Mechanismus, den ein `<form
    encType="multipart/form-data" action="">` clientseitig ohne JavaScript nutzt) — bestätigt, dass
    eine vollständig befüllte Zeile korrekt alle neuen Felder anlegt, eine Zeile mit Ausbildungsstufen-
    Lücke und eine mit unbekanntem Dienstgrad korrekt mit der erwarteten Fehlermeldung abgelehnt
    werden, und der Export für einen vollständig befüllten Testbenutzer alle neuen Spalten korrekt
    zeigt.
- **Atemschutzgeräteträger-Zuweisung** (`UserFormSheet`, Person section, next to `phone`): a plain
  `istAtemschutzgeraeteTraeger` `Switch`, mirroring `isActive`'s row styling — this is where the boolean
  "IS this person an Atemschutzgeräteträger" gets set now (moved out of Heimatfeuerwehr, see Module 4 above);
  `userSchema`/`parseUserFormData` carry it, `createUser`/`updateUser` persist it directly on `User`. The
  three Untersuchung/Gültig-bis/Finnentest date fields and the AKTIV/expiry overview remain exclusively in
  `/admin/heimatfeuerwehr` (`AtemschutzEditDialog` no longer has a traeger toggle at all — it only shows/edits
  the three dates, and that page's members-Query now filters to `istAtemschutzgeraeteTraeger: true`, so a
  non-Träger member simply doesn't appear in that table anymore, instead of showing dashes).
- **Benutzerverwaltung: Feuerwehr-Admin-Scoping** — a later round opened this page up to plain Feuerwehr-Admins
  (previously `isSiteAdmin`-only, see the "Security hardening" note in Module 4 above), so a Feuerwehr-Admin
  can see/edit/create users of their **own** Heimat-Feuerwehr/Feuerwehren without needing the
  Abschnittskommando-Admin right — mirroring how `/admin/heimatfeuerwehr` already worked. New permission
  functions in `lib/auth/permissions.ts`: `canManageUsersFor(user, organizationId)` (identical rule to
  `canManageHeimatfeuerwehrFor` — Site-Admin or Admin of that org — given its own name for readability at
  Benutzerverwaltung call sites, since the rule could diverge later) and `canAccessUserManagementAdmin(user)`
  (nav/page visibility, same shape as `canAccessHeimatfeuerwehrAdmin`). `admin/benutzer/page.tsx`'s own gate
  changed from `isSiteAdmin` to `canAccessUserManagementAdmin`, and for a non-site-admin both the `users`
  query (`homeOrganizationId: { in: user.feuerwehrAdminOrgIds }`) and the `organizations` list passed down
  (same `{ in: ... }` filter) are scoped — the latter is what actually enforces "a Feuerwehr-Admin can only
  create/move users into their own Feuerwehr and can only grant 'Admin für' on their own Feuerwehr", since
  `UserFormSheet`'s Heimat-Feuerwehr `OrgSearchSelect` (see GitHub issue #13 above) and "Admin für"
  `AdminOrgMultiSelect` are built directly from that array, offering no other org as an option in the
  first place. Every Server Action in `admin/benutzer/actions.ts`
  (`createUser`/`updateUser`/`deleteUser`/`setUserActive`/`sendPasswordResetEmailToUser`/`bulkSetActive`/
  `bulkSetHomeOrganization`) independently re-checks `canManageUsersFor` against every affected user's (and,
  for create/update/bulk-move, the target) `homeOrganizationId` — the scoped UI is a convenience, not the
  security boundary, same "never trust that the page-level check ran" philosophy already used elsewhere in
  this codebase (e.g. the QR quick-register token). A new `canGrantAdminFor` helper additionally guards
  `adminOrgIds` so a Feuerwehr-Admin can't grant "Admin für" on a Feuerwehr they don't manage via a direct
  Server Action call, even though the UI checkbox list already excludes that option. **Only a full
  Abschnittskommando-Admin (`isSiteAdmin`) still sees/manages every Feuerwehr's users** — this is enforced by
  `canManageUsersFor`/`canManageHeimatfeuerwehrFor` unconditionally returning `true` for a site admin
  regardless of `feuerwehrAdminOrgIds`. The Excel Export/Import links and routes
  (`/admin/benutzer/export`/`/admin/benutzer/import`) stayed **`isSiteAdmin`-only** — not scoped, hidden
  entirely from a plain Feuerwehr-Admin's UI (`UserManagementSection`'s new `isFullAdmin` prop) rather than
  built out to a per-org export, since a bulk cross-Feuerwehr spreadsheet feature wasn't part of this ask.
  Verified directly (not just type-checked): synthetic Feuerwehr-only-admin/site-admin/plain-member
  `SessionUser` objects run through `canManageUsersFor`/`canAccessUserManagementAdmin` produced exactly the
  expected true/false matrix (own org yes, other org no, site admin always yes, plain member never).

**Benutzerverwaltung-Brief.md ("Benutzer bearbeiten"-Sheet, Claude Design)** — a follow-up mockup-driven
rework of `UserFormSheet` specifically (the table/filters/bulk-actions from Verwaltung-Brief.md Phase 3-6
are untouched), imported the same way as the Dashboard Feuerwehrhaus brief earlier in this file: a
Claude Design project read via the `DesignSync` MCP tool's `list_files`/`get_file` methods (works for any
project the user can read, not only ones under the tool's own "design-system" writable-project model its
description emphasizes) rather than a browser/WebFetch flow.

- **Zwei neue Zeitstempel**: `User.lastLoginAt`/`User.passwordChangedAt` (both nullable, additive
  migration `20260802190718_user_last_login_password_changed_at`) - deliberately **not** backfilled from
  `createdAt` for existing users; an invented value is worse than "unknown". `lastLoginAt` was originally
  written only in `auth.config.ts`'s `jwt` callback's `if (user)` branch (a fresh sign-in) via a
  fire-and-forget `prisma.user.updateMany(...).catch(...)` - no `select`, no `await`, so a slow/failed write
  can never add latency to or block a login, matching the brief's explicit "darf die Anmeldung nie
  blockieren."
  - **Follow-up: "Zuletzt aktiv" auf echte Nutzung statt nur Login umgestellt.** Login-only war für den
    App-Betreiber "nicht brauchbar" - bei next-auth's Standard-Session-Gültigkeit meldet sich ein Benutzer,
    der die App täglich nutzt, oft monatelang nicht neu an (nur ein abgelaufener Token erzwingt einen
    neuen Login), sodass das Feld für lange Zeiträume auf einem veralteten Datum stehen bliebe. Die "kein
    frischer Login"-Verzweigung desselben `jwt`-Callbacks (die auf praktisch jedem Request läuft, siehe
    `middleware.ts`'s Matcher) aktualisiert `lastLoginAt` seither zusätzlich bei jeder echten Nutzung -
    gedrosselt auf höchstens 1x/Stunde (`LAST_ACTIVE_THROTTLE_MS`), da diese Verzweigung sonst auf jedem
    einzelnen Request eine zusätzliche Schreiblast erzeugen würde; die Drossel-Entscheidung braucht keine
    weitere DB-Abfrage, weil dieser Zweig `dbUser` (inkl. `lastLoginAt` als normale Skalarspalte) für den
    Berechtigungs-Refresh ohnehin schon lädt. Die Spalte heißt weiterhin `lastLoginAt` (keine Migration für
    eine reine Bedeutungserweiterung), trägt jetzt aber "letzter Login ODER letzte echte Nutzung, je nachdem
    was aktueller ist" - UI-Text dazu wurde von "zuletzt angemeldet" auf "zuletzt aktiv" umbenannt
    (`user-form-sheet.tsx`'s Sheet-Kopf-Zeile und Fallback-Text "noch nie aktiv"; die Tabellenspalte hieß
    ohnehin schon "Zuletzt aktiv", keine Änderung dort nötig).
  `passwordChangedAt` is set in all three places a
  password can actually change: `aktivieren/[token]/actions.ts` (first-time setup),
  `passwort-zuruecksetzen/[token]/actions.ts` (reset-link), and `profile/actions.ts`'s `changePassword`
  (self-service). `src/lib/format.ts`'s new `formatRelativeDate(date, {fallback})` is the single formatter
  for both - always computed server-side pinned to `Europe/Vienna` (`Intl`/`toLocaleDateString` with an
  explicit `timeZone`, never a bare client-side `toLocaleDateString`, which would produce a hydration
  warning if server/browser clocks ever ran in different zones) - returns `{label, title}`: `label` is the
  short "heute HH:mm"/"gestern HH:mm"/"vor N Tagen"(≤7)/`DD.MM.YYYY`(older)/fallback(null) string for
  display, `title` the full `DD.MM.YYYY, HH:mm` for a tooltip. A same-file `isOlderThanMonths(date, n)`
  helper mutes the new "Zuletzt aktiv" table column once a login is >12 months stale. Both were verified
  with a standalone script against several offsets (today/yesterday/3d/7d/8d/60d, and the 12-month-mute
  boundary) rather than only type-checked, since neither depends on any harness-blocked client interaction.
- **Kein Admin-gesetztes Klartext-Passwort mehr**: `userSchema`/`parseUserFormData` lost their `password`
  field entirely, and `updateUser` no longer has the `...(data.password ? {passwordHash: ...} : {})`
  branch - satisfies the brief's own acceptance criterion "kein Weg mehr, über den ein Admin ein Passwort im
  Klartext setzen kann." In its place, edit mode's Zugang section shows a "Passwort" row with a
  "Reset-Mail senden" button (`variant="outline"`) instead of an input, behind an `AlertDialog` confirm,
  reusing the **existing** `sendPasswordResetEmailToUser` action unchanged in its core (already
  `canManageUsersFor`-scoped from the earlier Feuerwehr-Admin-Scoping round above) - two things were added
  to that action for this brief specifically: a rate limit (`prisma.passwordToken.count` of
  `PASSWORD_RESET`-purpose rows created in the last hour for that user, ≥3 blocks - deliberately a **shared**
  budget with the separate self-service "Passwort vergessen" flow rather than a second, independent counter,
  since both ultimately just create the same kind of token/email; verified against 0/2/3-tokens-in-window
  and an out-of-window old token via a direct script against the local DB, not just read for correctness) and
  a `console.log` line recording who triggered it and when - a deliberate, explicit choice over adding a
  persisted audit column (`PasswordToken.triggeredByUserId` or similar), confirmed with the app owner rather
  than assumed. The button is disabled (with a `Tooltip` explaining why - "Zugang ist deaktiviert" /
  "Keine E-Mail-Adresse hinterlegt") when the live, not-yet-saved `isActive`/`email` form values say so, and
  goes into a 60-second client-only "Gesendet" cooldown after a successful send (against
  double-click-spam; the server-side hourly count is the real protection, this is just UX). The row's own
  "Zuletzt geändert"-line reads `passwordChangedAt` through the same `formatRelativeDate`.
- **Sheet-Geometrie**: the "Zugang aktiv" toggle moved out of the Zugang section into its own
  `bg-surface-sunken` strip directly under the header (edit mode only, matching its previous
  edit-mode-only visibility) - deliberately placed **outside** the scrolling `<form>` element entirely; this
  works because `handleSubmit` reads from react-hook-form's shared `control` state, not from native DOM
  form-traversal, so a `Controller`-registered field doesn't need to be a DOM descendant of `<form>` to be
  included in submission. The header itself dropped the old "X bearbeiten" title suffix (now just the
  person's name) and gained a subtitle line, edit mode only: `"{Heimat-Feuerwehr} · zuletzt angemeldet
  {formatRelativeDate(lastLoginAt).label}"`.
- **Feldpaarung (Person)**: Vorname/Nachname and Telefonnummer/Standesbuchnummer are now each a
  `grid-cols-1 sm:grid-cols-2` pair (stacking below the app's usual `sm:` breakpoint, matching the brief's
  own explicit "<640px" reference) instead of four full-width rows.
- **"Admin für" Mehrfachauswahl**: `src/components/admin/admin-org-multiselect.tsx`
  (`AdminOrgMultiSelect`) replaces the checkbox list with a `Popover`+`Command` combobox - closed state is a
  button styled as an input showing removable chips (`bg-brand-subtle` pills with an `×`) or a
  "Keine Adminrechte" placeholder; open state adds a search input, a "N von M ausgewählt"/"Auswahl leeren"
  status row, and a scrollable, keyboard-navigable list. Deliberately renders its own left-aligned checkbox
  square per row instead of relying on `CommandItem`'s built-in right-side checkmark
  (`group-data-[checked=true]/command-item:opacity-100`, which needs a consumer-set `data-checked` this
  component never sets and stays permanently hidden) - cmdk's own `data-selected` tracks keyboard-hover
  highlighting only, not "is this org chosen," so the actual chosen-state visual has to come from this
  component's own `value` prop, not cmdk's internal state. `Command`'s `shouldFilter={false}` disables
  cmdk's built-in fuzzy filter in favor of a plain `.includes()` substring match against the search text,
  since the brief's own "Feuerwehr suchen" is a simple filter, not fuzzy search. Backspace on an empty
  search input removes the last chip (checked via the search state, not a DOM query). Keyboard/Escape
  behavior (tab to the trigger, Enter/Space opens, Escape closes and returns focus) all comes for free from
  Radix `Popover`'s own default behavior - no custom focus-management code was added for this, and none of
  Popover's defaults were overridden.
- **"Funktionen und Ausbildung"**: a new bordered block replacing the old standalone "Drohnengruppe"
  section - the Atemschutzgeräteträger toggle moved here from Person (a qualification, not a stable
  identity fact, per the brief), and Drohnengruppe itself is now a `SegmentedControl`
  (`src/components/ui/segmented-control.tsx`, "Kein · Mitglied · Admin") instead of a `RadioGroup` column.
  `SegmentedControl` deliberately builds directly on the raw `radix-ui` `RadioGroup` primitive rather than
  restyling the existing pre-styled `components/ui/radio-group.tsx` (whose round-dot look doesn't
  reasonably restyle into segments) - still a real ARIA radiogroup underneath (arrow-key navigation, one tab
  stop), just with fully custom segment markup instead of `radio-group.tsx`'s dot/label layout.
- **Footer "Benutzer löschen"**: a new red text-button on the footer's left (edit mode only), behind an
  `AlertDialog`, reusing `deleteUser` unchanged - previously this action only existed in the table's own
  row-menu (`user-row-actions.tsx`); the brief explicitly asked for it inside the sheet too, "den Weg gibt
  es im Sheet bisher gar nicht." Closes the sheet and refreshes the table on success, same as the row-menu's
  own delete flow.
- **Tabelle "Zuletzt aktiv"**: a new sortable column, `xl:`-visible like `E-Mail`/`Drohnengruppe`/`Push`
  next to it, reading `lastLoginAt` through `formatRelativeDate` (fallback `"–"`, per the brief's own
  wording for this specific spot - the Sheet header uses a different fallback, "noch nie angemeldet", for
  the same underlying field) and muted (`text-ink-faint`) via `isOlderThanMonths(…, 12)`.
- **Verification note, same harness-wide gap as every previous Verwaltung phase**: this browser-automation
  environment still doesn't hydrate client-side React on this page (`__reactFiber$` lookup on `document.body`
  found none after navigating with `?edit=<id>`, and the Sheet's own Portal-rendered content is correctly
  absent from the raw server HTML for the same reason - Radix Portals need a live client to mount, so a
  static SSR snapshot never includes them regardless of whether `initialEditUserId` seeded the right initial
  React state). This blocks any interactive check of the Popover/Command combobox, the segmented control,
  or either `AlertDialog`. What *was* verified directly against the live app instead: logging out and back
  in via the real (non-hydration-dependent, native-form) login flow and confirming `lastLoginAt` actually
  updates and renders correctly ("heute HH:mm") in the "Zuletzt aktiv" column; the reset-rate-limit's exact
  DB query logic (0/2/3-in-window counts, and that an out-of-window token is correctly excluded) against the
  real local database; and `formatRelativeDate`/`isOlderThanMonths`'s date math against several concrete
  offsets - plus a clean `tsc`/production build across the whole change.

**Dienstgrad (NÖ-Feuerwehr-Rangdropdown)** — a follow-up request to add rank (Dienstgrad) to
Benutzerverwaltung, always shown/edited as its official short form only (e.g. `LM`, `HBI`, `ABI`, `FM`,
`SB`, `EOBI`), backed by a new central lookup table rather than a free-text field, so the value can never
drift from the NÖ Landesfeuerwehrverband's actual rank names.

- **`Dienstgrad` model** (`prisma/schema.prisma`): `kurzform` (`@unique`, the only form ever displayed),
  `bezeichnung` (full name, shown nowhere in the UI today - kept purely as a documentation/future-proofing
  field on the row itself), `kategorie` (`DienstgradKategorie` enum: `MANNSCHAFT`/`CHARGE`/`OFFIZIER`/
  `VERWALTUNG`/`SACHBEARBEITER`/`SONDERDIENSTGRAD`/`EHRENDIENSTGRAD` - informational grouping only, no
  permission logic attached), `sortOrder` (`@unique`, the actual professional hierarchy within each
  category, not alphabetical - lowest rank first). `User.dienstgradId` is nullable (existing members have
  none set) with `onDelete` left at Prisma's default (`Restrict`) since there's no legitimate reason to ever
  delete a row from this reference table. **The 46-row seed list was researched, not invented**: fetched via
  `WebSearch`/`WebFetch` against Wikipedia's "Dienstgrade der Feuerwehr in Österreich" (Niederösterreich-
  specific section) and AustriaWiki/austria-forum.org's mirror of the same article, cross-checked between
  both sources for the base Mannschafts-/Chargen-/Offiziers-/Verwaltungs-/
  Sachbearbeiter-/Sonderdienstgrade list, then a **second, targeted search specifically for the
  Ehrendienstgrade** (honorary ranks for retired officers who keep an "Ehren-"-prefixed title, e.g. the
  user's own example `EOBI` = Ehren-Oberbrandinspektor) since the first source didn't cover those at all.
  The full researched draft (all 46 entries, grouped by category) was presented back to the user for
  confirmation before seeding - specifically flagging that `EOBI` was initially missing from the first
  source - rather than committing invented or half-verified official rank names for a real Austrian
  volunteer fire brigade organization's actual personnel records. The user confirmed the full scope
  (including the rarely-used Verwaltungs-/Sonderdienstgrade categories) explicitly.
- **`prisma/seed.ts`**: `DIENSTGRADE` array + an idempotent `upsert`-by-`kurzform` loop, same pattern as the
  existing `DROHNEN_NAMEN` seeding just above it - safe to re-run against a live production database via the
  already-documented one-off `db seed` command (see "Stack" section) without touching any other data.
- **UI**: `UserFormSheet`'s Person section first row is now a 3-column
  `grid-cols-1 sm:grid-cols-3` (`[Dienstgrad] [Vorname] [Nachname]`, was a 2-column
  Vorname/Nachname pair) with a `Select` sourced from the `dienstgrade` list (now threaded as a new prop
  through `page.tsx` → `UserManagementSection` → `UserFormSheet`, alongside `organizations`) - a `"NONE"`
  sentinel value maps to/from the field's real empty-string state, since Radix `Select.Item` can't take a
  literal empty-string `value`. Every `SelectItem`'s rendered text is the bare `kurzform` only (not
  `"kurzform – bezeichnung"`) in both the closed trigger and the open list, deliberately - Radix's
  `Select.Value` always mirrors whichever `SelectItem`'s text was registered for the current value (it
  can't show different text in the trigger vs. the list), and showing the full name only in the list would
  have meant abandoning "nur die Kurzform" for that one surface. A new "Dienstgrad" column (always visible,
  not `xl:`-gated, since rank is core identifying info alongside the name next to it) was added to the
  desktop table - and, since roster convention is to show rank directly in front of a name, the mobile
  `UserCard` also gained a small muted `{kurzform} ` prefix before the name text, reusing the same
  `UserRow.dienstgrad` string both places read from.
- Verified: the full 46-row seed against the local database (correct count, correct `kurzform`/`bezeichnung`/
  `kategorie` for a sample), and the actual rendered table column showing the correct short form for a real
  user after setting `dienstgradId` directly in the database - the Sheet's own `Select` interaction itself
  falls under the same already-documented harness-wide hydration gap as every other Sheet control in this
  module and couldn't be click-tested directly.

**Benutzerstatus: Inaktiv vs. Deaktiviert (Atemschutz/Drohnengruppe-Sichtbarkeit)** — a real reported bug:
a brand-new user, created but not yet clicked through their activation link, is `isActive: false` exactly
like an explicitly deactivated user - both collapsed onto the same boolean, so the Atemschutz table
(`/admin/heimatfeuerwehr`) and the Drohnengruppe pilot-picker/flight-eligibility check both hid a never-
activated member just as thoroughly as a genuinely deactivated one, making it impossible to pre-enter their
Atemschutzuntersuchung/Finnentest or record a drone flight they'd already flown before the account existed
in this app.

- **`src/lib/auth/user-status.ts`** (new) introduces a derived, non-persisted 3-state distinction rather
  than a new DB column: `getUserStatus(user): 'AKTIV' | 'INAKTIV' | 'DEAKTIVIERT'` reads `isActive` +
  `passwordChangedAt` - `AKTIV` if `isActive`, else `DEAKTIVIERT` if `passwordChangedAt` is set (the account
  was activated/reset/self-changed at some point, so `isActive: false` means an admin deliberately turned it
  off), else `INAKTIV` (never activated at all). `passwordChangedAt` is set exactly once by activation/
  password-reset/self-service-change and **never cleared again** (not even by another deactivation), so this
  derivation stays correct across any number of activate/deactivate cycles. Deliberately not a new enum
  column: the existing `isActive` boolean still drives login and every other existing check unchanged
  (nothing about auth gating changed), and the three-state read is only needed at a handful of display/
  filter call sites. Accepted, rare edge case: an admin who deactivates a user who has *never* activated at
  all sees them still labeled "Inaktiv" rather than "Deaktiviert" (both still correctly hidden from nothing,
  since only `DEAKTIVIERT` is ever hidden - see below) - judged acceptable rather than adding a dedicated
  `activatedAt` column for a scenario with no real consequence.
- **`NOT_DEACTIVATED_WHERE`** (same file) is the companion Prisma `where`-fragment for the opposite
  direction - which users an admin-facing "who's an eligible/active member" query should still include:
  `{ OR: [{ isActive: true }, { isActive: false, passwordChangedAt: null }] }`, i.e. everyone except
  `DEAKTIVIERT`. Applied at exactly the three places that previously read a plain `isActive: true`:
  the Atemschutz-Tabelle's member query (`admin/heimatfeuerwehr/page.tsx`), and both
  `listDrohnengruppeMembers()` and `isEligiblePilot()` (`src/lib/drone/members.ts`) - the latter two are
  shared by the flight-registration pilot picker, the write-time eligibility re-check in
  `createFlight`/`updateFlight`, and the 90-Tage-Report, so broadening them once fixes all three consistently
  rather than only the flight form (confirmed as the desired behavior with the app owner rather than assumed
  - a never-activated Drohnengruppe member's compliance is legitimately worth tracking in those reports too,
  not just recordable). The Einsatzbereitschaft module (`src/lib/drone/einsatzbereitschaft.ts`, see the
  Drohnengruppe module section above) came later and applies this same `NOT_DEACTIVATED_WHERE` filter
  independently to its own `prisma.drohnengruppeMembership.findMany` query - it doesn't call
  `listDrohnengruppeMembers()` (a deliberate, separately-documented tradeoff, see that section), so it needed
  its own copy of this guard rather than inheriting it for free. Saving Atemschutz
  dates itself already had no `isActive` gate of its own (`updateAtemschutzStatus` only checks
  `canManageHeimatfeuerwehrFor`) - the bug was purely that the page never surfaced the row/edit-trigger to
  click in the first place, so widening the query alone was the complete fix for that half of the report.
- **Benutzerverwaltung UI**: the previously 2-state Aktiv/Inaktiv badge (`UserCard` mobile card, desktop
  table row) and the Status filter `Select` (2 options, `SimpleFilter`'s `JA`/`NEIN`) both become genuinely
  3-state, driven by `getUserStatus()` - green/amber/red (`success`/`warning`/`danger` tokens, the same
  amber already used for "läuft bald ab" elsewhere in Heimatfeuerwehr) for Aktiv/Inaktiv/Deaktiviert
  respectively. A new `StatusFilter` type (`'ALLE' | UserStatus`) replaces `SimpleFilter` for the status
  filter specifically - `SimpleFilter` (`ALLE`/`JA`/`NEIN`) stays exactly as before for the unrelated Rolle
  filter. The existing single "Zugang aktiv" on/off toggle in `UserFormSheet` is **unchanged** - no new
  control was added; which of the two "off" labels shows is purely a consequence of whether that user had
  ever been active before, decided deliberately with the app owner over adding a manual status picker. The
  Excel export's "Status" column (previously a bug-for-bug-identical `isActive ? 'Aktiv' : 'Deaktiviert'`,
  silently mislabeling a never-activated user as "Deaktiviert") now reads the same three labels via
  `getUserStatus()` too, for consistency with the on-screen badge.
- **Data retention, unchanged/confirmed rather than built**: a `DEAKTIVIERT` user's `atemschutz*` fields
  (plain columns on `User`) and `DroneFlight` rows (`onDelete` unrelated to `User.isActive`) were never
  touched by any of this - deactivating only ever changes visibility via the query filters above, never the
  data itself, and reactivating (`isActive: true` again) makes both reappear exactly as they were. Only
  actually deleting the `User` row cascades away that history, which was already true before this change and
  needed no new code.
- Verified directly against the real dev database (not just read for correctness): a standalone script
  created a never-activated Atemschutzgeräteträger + Drohnengruppe-Pilot, confirmed they appear in the
  Atemschutz query, `listDrohnengruppeMembers()`, and `isEligiblePilot()`; added a real Untersuchungsdatum
  and recorded a real past `DroneFlight` for them; simulated activation-then-deactivation and confirmed the
  derived status flips to `DEAKTIVIERT` and the same three checks now correctly exclude them while the
  Atemschutz date and the flight row both remain in the database untouched; then reactivated and confirmed
  visibility returns. 17/17 assertions passed. Also confirmed live in the browser (this session's rendered
  HTML, not just the underlying query): three real users (never-activated, currently active, previously-
  active-then-deactivated) each show the correct one of the three distinct badge labels/colors in both the
  mobile card list and the desktop table.

- `/admin/status` — `SystemCheckPanel` calls `runSystemCheck()` only on button click (not on page load).
  "Docker läuft" is actually a live `SELECT 1` through Prisma, not a Docker-daemon check (the app container
  can't see the host daemon) — a successful query proves the app ↔ Postgres Compose network path is up,
  which is the practically useful signal. "Mailjet Integration" is a read-only, non-sending authenticated
  call (`checkMailjetConnection` in `mailjet.ts`) against Mailjet's own API-key endpoint. Three more checks
  work around the same "app container can't see the host" limit that shapes "Docker läuft": "Cron Job
  (News)" and "Letztes Backup" don't probe the host directly (no visibility into the host crontab or
  `docker/backups/`) — instead the cron endpoint (`/api/cron/send-scheduled-news`) calls
  `recordNewsCronRun()` on every invocation (even when nothing was due) and `docker/backup.sh` runs a direct
  `psql` UPSERT after each successful `pg_dump`, both writing into `AppSettings.lastNewsCronRunAt` /
  `lastBackupAt`; the Status page only reads those columns back via `src/lib/settings.ts` and flags them
  stale after 15 minutes (cron runs every 5) / 26 hours (nightly backup) respectively. `docker/backup.sh` and
  `docker/send-scheduled-news.sh` are tracked executable in git (`git update-index --chmod=+x`) — both run
  directly off the host checkout via cron with no build step to fix the mode for them (unlike
  `entrypoint.sh`, which the `Dockerfile` `chmod +x`s during the image build). A real incident: both scripts
  were committed non-executable, so every cron invocation since initial deploy silently failed with
  `Permission denied` into their respective log files, with no other visible symptom — don't let a future
  `git add` of a new host-cron script re-introduce this; check `git ls-files -s` shows `100755` for it.
  `backup.sh` additionally uploads the dump to an S3-compatible bucket (Exoscale SOS) when
  `S3_BACKUP_BUCKET` is set in `.env`, purely as an off-box copy alongside the existing local one — see
  "Off-Box-Kopie" in `docker/README.md`. It also tars up `.env` and `docker/Caddyfile` into a
  `config-<timestamp>.tar.gz` (`chmod 600`, deleted locally right after upload) and uploads that too — the DB
  dump alone can't restore a working server: `.env` is `.gitignore`d and only ever exists on this one host,
  and losing `VAPID_PRIVATE_KEY` specifically would permanently strand every `PushSubscription` row the DB
  restore brings back, forcing all ~200 members to re-enable push by hand. The config archive isn't kept
  locally (no local retention line to maintain for it) since the source files already sit right next to
  `backup.sh` on disk — a local copy of them would add no protection a full-disk loss wouldn't also destroy.
  Retention for the S3 copies is scripted directly in `backup.sh`
  (list objects older than 30 days via `aws s3api list-objects-v2`, then `aws s3 rm` each), mirroring the
  local `find -mtime +30`, rather than a bucket lifecycle rule — confirmed by testing that Exoscale SOS has
  no native lifecycle support at all yet (`PutBucketLifecycleConfiguration` either silently no-ops or
  errors `MalformedXML` depending on the rule shape); their own workaround for this is a separate
  Docker-based tool that additionally requires bucket versioning enabled, which was judged disproportionate
  for a handful of small backup files. "NTP-Synchronisierung"
  can't run a real NTP client check inside the container either (it shares the host's clock, so there's
  nothing container-local to check) — `src/lib/system/ntp-check.ts` instead compares local time against the
  `Date` response header of an external HTTPS call (`api.mailjet.com`) as a drift proxy, flagging >10s as
  out of sync. **"S3 Exoscale Verbindung" and "Letztes S3-Backup" (GitHub issue #2)** cover the off-box
  copy specifically, since the checks above only ever reflected the local `pg_dump` succeeding, not whether
  the S3 upload did: `src/lib/system/s3-check.ts`'s `checkS3Connection()` is a live, read-only `HeadBucket`
  call via `@aws-sdk/client-s3` (the one SDK dependency in this codebase — hand-rolling SigV4 request
  signing over plain `fetch`, the pattern used for Mailjet, was judged too error-prone for something
  security-sensitive) against `S3_BACKUP_BUCKET`/`S3_ENDPOINT_URL`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`, returning
  `false` for both "not configured" and "reachable but auth/network failed" — same simple boolean semantics
  as `checkMailjetConnection`, no third state. The AWS SDK requires a `region`; Exoscale SOS endpoints have
  the form `https://sos-<zone>.exo.io` and expect that zone as the signing region, so
  `regionFromEndpoint()` extracts it from `S3_ENDPOINT_URL` rather than hardcoding one. "Letztes S3-Backup"
  is a staleness check on a new `AppSettings.lastS3BackupAt` column, written by `backup.sh` — but
  deliberately placed AFTER the `aws s3 cp` of the DB dump succeeds, not alongside the pre-existing
  `lastBackupAt` write (which happens right after the local `pg_dump`, before the S3 block even runs): the
  script's `set -e` means a failing upload aborts before that `INSERT` is ever reached, so a stale
  `lastS3BackupAt` genuinely means "the off-box copy didn't happen," without needing any extra
  try/catch-style handling in the shell script itself.
- **Daily system-check email**: the same check that powers the `/admin/status` button also runs unattended
  once a day via `/api/cron/system-check` (secret-gated like `/api/cron/send-scheduled-news`) +
  `docker/system-check-email.sh` on the host crontab, mailing the result as a table to an address
  configured under `/admin/email` ("System Check E-Mail", `AppSettings.systemCheckNotificationEmail` via
  `src/lib/settings.ts` — same admin-configurable pattern as "Drohnenflug E-Mail", not hardcoded like
  `FEEDBACK_RECIPIENT`). `src/lib/system/notify-system-check.ts`'s `notifySystemCheckResult()` mirrors
  `notifyDroneFlightCreated()`'s shape exactly: reads the recipient from `AppSettings` and no-ops if unset,
  and wraps the send in try/catch so a Mailjet outage never fails the cron run itself. The manual "System
  Check" button on `/admin/status` calls the exact same `notifySystemCheckResult()` too (not only the daily
  cron) — deliberately, so an admin can trigger a real end-to-end test of the email path (recipient
  configured? Mailjet reachable?) on demand instead of waiting for the next 09:00 run.
  `runSystemCheck()` in `admin/status/actions.ts` is session-gated (`requireUser()` +
  `assertPermission(isSiteAdmin(user))`) and can't be called from a route with no session, so the actual
  check logic was pulled out into a plain `getSystemCheckResult()` in `src/lib/system/system-check.ts`; the
  Server Action is now a thin auth-check wrapper around it. The row-building logic that turns a
  `SystemCheckResult` into label/OK/detail rows (`buildSystemCheckRows`) had to move into its own
  dependency-free `src/lib/system/system-check-rows.ts` rather than living in `system-check.ts` itself —
  `system-check.ts` imports Prisma/Mailjet/NTP checks, and `system-check-panel.tsx` (`'use client'`) needs
  those rows for the UI, so importing the rows builder straight from `system-check.ts` would have pulled
  Prisma into the client bundle. Both the status page and the email call the same `buildSystemCheckRows`, so
  the two never drift out of sync on labels/wording.

**Geltungsbereich-Wähler** (`GeltungsbereichSelector`, `src/lib/admin/scope.ts`) — ein wiederverwendbarer
Bezirk/Abschnitt/Feuerwehr-Umschalter, der sowohl in der Desktop-`AdminSidebar` als auch pro Seite mobil
gerendert wird, für Bezirks-/Abschnitts-/Mehrfach-Feuerwehr-Admins mit mehr als einem erreichbaren
Geltungsbereich (`getReachableScopes`, `react`-`cache()`-dedupliziert pro Request, da sie sonst pro Seite
zweimal aufgerufen würde). Die gewählte Ebene lebt als URL-Query-Parameter,
`?ebene=bezirk|abschnitt|feuerwehr&bereich=<id>`, aufgelöst clientseitig über `useSearchParams()` und in
`localStorage` gemerkt. Der zweite Parameter heißt bewusst `bereich`, nicht `org` — `/admin/heimatfeuerwehr`
verwendet `?org=` bereits für ein eigenes, andersartiges Konzept (welche Feuerwehr diese eine Seite gerade
verwaltet), und ein gemeinsamer Name hätte den Wähler dort unbeabsichtigt in dieses Konzept hineinpfuschen
lassen. `GeltungsbereichSelector` ist die erste Komponente in dieser Codebase, die `useSearchParams()`
verwendet statt dem sonst üblichen Muster "eine `page.tsx` liest `searchParams` serverseitig und reicht den
Anfangswert als Prop nach unten durch" — das geht hier nicht, weil `admin/layout.tsx` die Desktop-Sidebar
rendert und Next.js-Layouts strukturell nie ein `searchParams`-Prop erhalten (nur `page.tsx`-Dateien tun
das), sodass eine vom Layout aus gerenderte Komponente keinen anderen Weg hat, die aktuelle Ebene zu
erfahren. Jede `/admin/*`-Seite liest/validiert den Parameter bei Bedarf trotzdem zusätzlich selbst aus
ihrem eigenen `searchParams`-Prop.

`/admin/benutzer` hat zusätzlich einen eigenen, seitenlokalen Abschnitt-Filter (`?abschnitt=`,
Bezirksadmin-only) — bewusst getrennt vom globalen `?ebene=`/`?bereich=` des Geltungsbereich-Wählers, auch
wenn Letzterer den Anfangswert vorbelegt (`resolveAdminScope` in `page.tsx`). `?abschnitt=ALLE` ist dabei ein
eigener, bedeutungsvoller Wert und nicht dasselbe wie ein fehlender Parameter: nur so überlebt ein explizites
Zurücksetzen des Filters (Chip-×) einen Reload, ohne dass der Geltungsbereich seinen eigenen Abschnitt beim
nächsten Laden erneut hineinzieht. Da ein `useState`-Initializer nur beim ersten Mount läuft, folgt ein
eigener Effekt (`user-management-section.tsx`) dem Geltungsbereich auch nach einer clientseitigen Navigation,
während die Seite bereits offen ist — der bloße Prop-Wechsel allein hätte den lokalen Filterzustand sonst
nicht nachgezogen. `OrgSearchSelect` (`src/components/admin/org-search-select.tsx`) ist die
Einzelauswahl-Variante von `AdminOrgMultiSelect` für genau diesen Filter und den Feuerwehr-Filter daneben;
`groupByAbschnitt` (`src/lib/admin/group-by-abschnitt.ts`) wurde aus zwei fast identischen
Abschnitt-Gruppierungen extrahiert, die beide Komponenten teilen.

**Benutzerverwaltung-Breite-Brief.md (Claude Design)** — `/admin` nutzt ab `md:` (768px) nicht mehr
den app-weiten `max-w-5xl`-Lesecontainer, sondern die volle Fensterbreite; die Benutzertabelle wurde
von einem `<table>`+`overflow-x-auto` auf ein fluides CSS-Grid umgestellt und Filtern/Sortieren/
Paginieren laufen seither serverseitig statt clientseitig über ein komplett geladenes
`UserRow[]`-Array (Verwaltung-Brief.md Phase 3's ursprüngliche Begründung "184 Datensätze
rechtfertigen kein serverseitiges Filtern" gilt bei 486 Mitgliedern nicht mehr).

- **Container/Layout**: `src/components/layout/main-container.tsx` (neu) ist eine Client-Komponente,
  die per `usePathname()` erkennt, ob die aktuelle Route unter `/admin` liegt, und nur dort ab `md:`
  `max-w-5xl`/`mx-auto`/das horizontale Padding von `<main>` wegnimmt - unterhalb von `md:` bleibt
  `<main>` unverändert (Mobile-Admin ist nicht Teil dieses Briefs, nutzt ohnehin
  `AdminMobileTabs`/Kartenlisten). `admin/layout.tsx` wechselte von `grid grid-cols-[210px_1fr]` auf
  `flex` mit `min-w-0` am Inhalts-Container (nicht optional - ohne `min-w-0` weigert sich das
  Flex-Kind zu schrumpfen und eine breite Tabelle erzeugt wieder einen Querscrollbalken) und ergänzt
  sein eigenes `md:px-7 md:py-6` genau dort, wo `MainContainer` für `/admin` aufhört, dieses Padding
  zu liefern. Der app-weite Header (`(app)/layout.tsx`) selbst bleibt bei `max-w-5xl` - dieser Brief
  betrifft ausdrücklich nur `/admin/**`, nicht die globale Kopfzeile; der dadurch entstehende
  Breitenunterschied zwischen Header und Admin-Inhalt ist eine bewusst akzeptierte, kleine
  Design-Inkonsistenz, kein Bug.
- **Sidebar**: `AdminSidebar` wuchs von 210px auf 246px und ist jetzt `position: sticky; top: 62px`
  (Höhe des app-weiten Headers) mit `height: calc(100dvh - 62px)` und eigenem `overflow-y-auto` -
  scrollt beim Scrollen der Tabelle nicht mehr mit. Die Kontextzeile des Geltungsbereich-Wählers
  ("Abschnitt 177 Purkersdorf · 12 Feuerwehren · **486 Mitglieder**") bekam die fett markierte
  Mitgliederzahl neu dazu: `scope.ts`'s neue `getScopeMemberCounts(user)` (`cache()`-dedupliziert wie
  `getReachableScopes`) macht eine einzige `groupBy` auf `User.homeOrganizationId` und addiert die
  Feuerwehr-Einzelzahlen in JS zu Abschnitts-/Bezirkssummen auf, statt pro Geltungsbereich eine eigene
  COUNT-Abfrage zu fahren. `GeltungsbereichSelector`'s `memberCounts`-Prop ist optional - nur
  `AdminSidebar` reicht sie durch, die übrigen (mobilen) Aufrufer zeigen die Kontextzeile weiterhin
  ohne Mitgliederzahl, das ist für dieses Brief (ausdrücklich Desktop-only) kein Problem.
- **Tabelle**: `USERS_GRID_COLS`/`USERS_GRID_ROW` in `user-management-section.tsx` sind die EINE
  geteilte Konstante für Kopf- und Datenzeilen (Brief-Vorgabe). Drei Breiten-Stufen statt Tailwinds
  Standardskala, weil der Brief genau bei 1600px eine zusätzliche Stufe braucht, die dort nicht
  existiert - `min-[1600px]:` ist Tailwinds Arbitrary-Variant-Syntax für einen Wert außerhalb der
  konfigurierten Skala, ohne `tailwind.config.ts` anzufassen (dieser Breakpoint wird sonst nirgends
  gebraucht). Spaltenreihenfolge folgt dem Mockup (`Benutzerverwaltung Desktop.dc.html`):
  Checkbox/Dienstgrad/Name/Feuerwehr/Rolle/[E-Mail/Drohnen ab `xl:`=1280px]/[Zuletzt aktiv/Push ab
  1600px]/Status/Menü - Status wandert damit hinter Push/Zuletzt-aktiv, anders als in der
  ursprünglichen `<table>`. Rolle und E-Mail sind `truncate` mit vollem Wert im `title`-Tooltip;
  "Admin für: AFKDO Purkersdorf, AFKDO Herzogenburg" wird dabei zur gekürzten Anzeige "Admin:
  Purkersdorf, Herzogenburg" (`stripAfkdoPrefix()` in `page.tsx`, nur für diese eine Kurzform-Anzeige
  - der Tooltip und `UserRow.adminFor` bleiben unverändert der volle Text).
  - **Bewusst NICHT übernommen**: das Mockup zeigt die "Drohnen"-Spalte als numerisches Abschnitts-
    Badge (z. B. "177" für die an AFKDO Purkersdorf verankerte Gruppe) statt der bisherigen
    Admin/Mitglied-Rollenanzeige - der Text-Brief selbst sagt dazu nichts, nur die Spaltenbreite
    (112px). Da eine Umdeutung des Spalteninhalts eine eigenständige Produktentscheidung wäre (welche
    Nummer, woher, was bei bezirksweiten/anonymen Gruppen), nicht Teil dieses Layout-Briefs, blieb
    `droneLabel` (Admin/Mitglied/–) unverändert - nur Breite/Position der Spalte folgen dem Mockup.
- **Filterleiste**: eine Zeile ab `md:` in einer weißen Karte (Suchfeld `flex-[1_1_340px]
  max-w-[400px]`, danach Abschnitt/Feuerwehr/Drohnengruppe/Rolle/Status mit festen Breiten
  176/176/176/148/136px), Chips darunter in derselben Karte. Neu: ein Drohnengruppe-Filter (`?
  drohnengruppe=`, plain `<Select>` statt `OrgSearchSelect` - bei ~4 Gruppen ist keine Suche nötig,
  identisch zur Drohnengruppen-Auswahl in der Bezirksverwaltung) - zeigt absichtlich auch deaktivierte
  Gruppen an (mit "(deaktiviert)"-Suffix), da ein Filter ein bestehendes-Mitglieder-Finden-Werkzeug
  ist, keine Neuzuordnungs-Auswahlliste (dieselbe Unterscheidung wie bei `OrgSearchSelect`'s
  Feuerwehr-Filter, der ebenfalls nie nach `isActive` filtert).
- **Server-seitige Filter/Sortierung/Paginierung** (`page.tsx`): `buildUsersWhere()` übersetzt
  q/abschnitt/feuerwehr/drohnengruppe/rolle/status 1:1 in Prisma-`where`-Fragmente - Status
  (AKTIV/INAKTIV/DEAKTIVIERT) ist dabei ein abgeleiteter Wert aus `isActive`+`passwordChangedAt`
  (dieselbe Regel wie `getUserStatus()`, hier nur direkt als Prisma-Filter statt als JS-Funktion
  ausgedrückt). Die Namenssuche verknüpft die Suchwörter per UND getrennt über Vor-/Nachname
  (`buildSearchWhere()`), damit sowohl "Krebs Florian" als auch "Florian Krebs" denselben Benutzer
  findet - ein einzelnes `contains` gegen "Nachname Vorname" wie zuvor clientseitig ginge nicht, diese
  Verkettung existiert in der DB nicht. `buildOrderBy()` bildet die bisherigen Sortierspalten auf
  Prisma-`orderBy` ab - für echte Skalarspalten (Name/E-Mail/StbNr/Telefon/Zuletzt aktiv) 1:1 exakt,
  für Status zusätzlich mit explizitem `nulls`-Modifikator (sonst würde Postgres NULLs in ASC ans
  Ende statt an den Anfang sortieren, was die INAKTIV-vor-DEAKTIVIERT-vor-AKTIV-Rangfolge umdrehen
  würde). Für `adminFor`/`droneLabel`/`dienstgrad` ist die Sortierung eine **bewusst akzeptierte
  Annäherung** (Anzahl Admin-Mitgliedschaften per `_count`, Drohnengruppen-Rolle, Dienstgrad-
  Kurzform statt des früher alphabetisch verglichenen, aus einer Relation zusammengesetzten
  Anzeige-Strings) - Prisma kann keinen über eine Relation aufgebauten String sortieren, nur echte
  Spalten/Aggregate. Paginierung: fix 50 pro Seite (`PAGE_SIZE`), `skip`/`take` nach einer separaten
  `count()`-Abfrage auf dieselbe `where`-Klausel; die angeforderte Seite wird auf `totalPages`
  geklemmt, damit eine veraltete Lesezeichen-URL mit zu hoher Seitenzahl nie eine leere Seite zeigt,
  obwohl frühere Seiten noch Ergebnisse hätten. "486 Mitglieder in 12 Feuerwehren" in der Kopfzeile
  ist bewusst die UNGEFILTERTE Gesamtzahl des Verwaltungsbereichs (zwei eigene, vom aktuellen Filter
  unabhängige Abfragen: `user.count`/`user.groupBy` auf denselben Scope wie jede andere Query hier),
  während "N angezeigt" und die Paginierungszeile "1–31 von 486" die GEFILTERTE Zahl zeigen - beide
  Zahlen fallen nur zufällig zusammen, wenn kein Filter aktiv ist.
- **URL-Zustand**: jede Filter-/Sortier-Änderung setzt `page` auf 1 zurück (sonst würde ein
  geänderter Filter auf "Seite 3" eines ganz anderen Ergebnisses landen) - nur die Zurück/Weiter-
  Buttons ändern `page` ohne diesen Reset. Derselbe `router.replace`-URL-Sync-Mechanismus aus
  Verwaltung-Brief.md Phase 3 ist jetzt nicht mehr nur ein Lesezeichen-Mechanismus, sondern der
  eigentliche Auslöser für den serverseitigen Refetch (Next.js führt `page.tsx`'s Server Component
  bei einer `searchParams`-Änderung über dieselbe Route serverseitig neu aus).
- **Mobile Kennzahlkarten** ("Mitglieder gesamt"/"Auf dieser Seite", `md:hidden`): mussten von
  `totalUsersCount` statt vom (jetzt nur noch seitenweise geladenen) `users`-Array abgeleitet werden,
  sonst hätte "Mitglieder gesamt" auf Mobile plötzlich nur die aktuelle Seite gezeigt. Die zweite
  Kachel zeigt bewusst `users.length` ("Auf dieser Seite") statt einer weiteren, ungefilterten
  "davon inaktiv"-Zahl - eine korrekte bezirksweite Inaktiv-Zählung hätte eine weitere Abfrage
  gebraucht, die dieses (ohnehin nicht Teil des Briefs seiende) Mobile-Widget nicht rechtfertigt.
- **Nicht live verifiziert**: dieselbe, bereits mehrfach in dieser Datei dokumentierte
  Mehrfach-Worktree-Bindungsschwäche der Dev-Server-Vorschau in dieser Umgebung (der laufende
  Next-Dev-Prozess zeigte per `Get-CimInstance Win32_Process` auf das node_modules des
  Haupt-Worktrees, nicht dieses Worktrees) verhinderte auch hier einen echten Browser-Test. Verifiziert
  wurden statt dessen ein durchgängig fehlerfreier `npx tsc --noEmit` und ein erfolgreicher
  `npm run build` über die gesamte Änderung.

