# Natives Android-Push über Firebase Cloud Messaging (FCM) — Design

## Ziel

Die native Android-App (Play Store, Capacitor-Hülle) bekommt echte Push-Benachrichtigungen. Aktuell
zeigt der Push-Schalter im Profilmenü dort nur "Push-Benachrichtigungen sind in dieser App-Version
nicht verfügbar" (`push-notifications-toggle.tsx`), weil Web Push (VAPID) technisch nicht innerhalb
einer Capacitor-WebView funktioniert — das war eine bewusste Scope-Entscheidung im ursprünglichen
Capacitor-Store-Rollout (`docs/superpowers/specs/2026-08-23-capacitor-store-rollout-design.md`),
jetzt als eigenes Folgeprojekt umgesetzt.

**Scope-Grenze (bewusst)**: nur Android. iOS bleibt unverändert bei "nicht verfügbar" — kein Mehraufwand
jetzt, kein Umbau später nötig, da das gewählte Capacitor-Plugin (`@capacitor/push-notifications`)
ohnehin plattformneutral ist.

## Architektur

Natives Push läuft **parallel** zum bestehenden Web Push, nicht als Ersatz. Beide Sendewege bleiben
unabhängig nebeneinander bestehen — ein Nutzer kann theoretisch beides gleichzeitig haben (Browser-
Session mit Web-Push-Subscription + Android-App mit FCM-Token). Kein Umbau der bestehenden
`sendPushToSubscriptions`/`PushSubscription`-Logik, nur ein zweiter, paralleler Pfad obendrauf.

## Datenmodell

Neue Tabelle `FcmToken` — bewusst eine eigene Tabelle statt einer Erweiterung von `PushSubscription`:
FCM-Tokens sind strukturell etwas anderes als Web-Push-Subscriptions (ein einzelner Token-String statt
endpoint+p256dh+auth), eine eigene Tabelle vermeidet erzwungen-nullable Felder auf der bestehenden
Tabelle und passt zum bisherigen Stil dieses Codebases (mehrere klare Tabellen statt einer mit
Sonderfällen).

```prisma
model FcmToken {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

`User` bekommt eine neue Relation `fcmTokens FcmToken[]`, analog zu `pushSubscriptions
PushSubscription[]`.

## Client-seitig (Android)

- Neues Capacitor-Plugin `@capacitor/push-notifications`.
- Der bestehende Toggle im Profilmenü (`PushNotificationsToggle`,
  `src/components/layout/push-notifications-toggle.tsx`) wird für die native Plattform
  **wiederverwendet** statt der aktuellen "nicht verfügbar"-Meldung — gleiche UI/gleicher Schalter,
  aber verhält sich auf Android anders:
  - Beim Aktivieren: fragt die native Benachrichtigungsberechtigung ab (`PushNotifications.requestPermissions()`),
    registriert bei FCM (`PushNotifications.register()`), liest den Token über den
    `registration`-Listener und sendet ihn per neuer Server Action `saveFcmToken(token)`
    (spiegelt `savePushSubscription`) an den Server.
  - Beim Deaktivieren: ruft eine neue Server Action `deleteFcmToken(token)` auf (spiegelt
    `deletePushSubscription`), plus lokal `PushNotifications.unregister()` falls vom Plugin unterstützt.
- Tap-Navigation: ein neuer Listener (`pushNotificationActionPerformed`) übernimmt, was `public/sw.js`s
  `notificationclick`-Handler im Browser macht — liest `data.url` aus der Payload und navigiert per
  Next-Router (`router.push`) dorthin. Gleiches Payload-Format wie bisher (News- und Kalender-Push
  senden schon `data: { url }`), keine Änderung an der Payload-Erstellung auf Serverseite nötig.
- Foreground-Empfang (`pushNotificationReceived`, App ist gerade offen): zeigt einen einfachen
  `sonner`-Toast statt einer System-Benachrichtigung — konsistent mit diesem Codebase's bestehendem
  Toast-Mechanismus, keine neue UI-Komponente nötig.

## Server-seitig

- Neue Datei `src/lib/push/fcm-client.ts` mit `sendPushToFcmTokens(tokens, payload)` — nutzt das
  **`firebase-admin`-SDK** (Entscheidung im Brainstorming: bewusst das offizielle SDK statt der
  schlankeren `google-auth-library`+fetch-Variante, die dieser Codebase sonst bevorzugt — nimmt hier
  mehr Token-Handling/Payload-Formatierung ab). Gleiche Struktur wie `sendPushToSubscriptions`:
  ungültige/abgelaufene Tokens werden anhand des SDK-Fehlercodes (`messaging/registration-token-not-registered`)
  erkannt und aus der `FcmToken`-Tabelle entfernt, analog zur bestehenden 404/410-Behandlung bei
  Web-Push-Endpoints.
- Beide bestehenden Sendestellen rufen zusätzlich zu `sendPushToSubscriptions` auch
  `sendPushToFcmTokens` auf:
  - `src/lib/news/dispatch-news.ts` (`dispatchNewsPost`)
  - `src/lib/push/send-event-push.ts` (`sendEventPushNow`)

  Die Audience-Auflösung (welche User sollen benachrichtigt werden) bleibt in beiden Fällen
  unverändert — nur der letzte Schritt "wie erreiche ich die Geräte dieses Users" bekommt einen
  zweiten, parallelen Pfad (Web-Push-Subscriptions UND FCM-Tokens des Users, beide abgefragt und
  beide bedient).
- Neues Secret: Firebase-Service-Account-JSON als Umgebungsvariable (Name: `FIREBASE_SERVICE_ACCOUNT_JSON`),
  behandelt wie `googleCalendarServiceAccountJson` — nie an den Client zurückgegeben. Muss ergänzt
  werden in: `.env.example`, `.env.staging.example`, UND den `environment:`-Blöcken beider
  `docker-compose.yml`/`docker-compose.staging.yml` (dieses Repo hat bereits zweimal dokumentiert,
  dass das Vergessen des letzten Schritts ein echter Produktionsbug war — siehe root `CLAUDE.md`).

## Firebase-Setup (außerhalb des Repos — manuell, kein Code)

Neues Firebase-Projekt, kein bestehendes wiederverwendbar:

1. Firebase-Projekt neu anlegen (console.firebase.google.com)
2. Android-App im Projekt registrieren mit Paketname `at.bfkdostpoelten.app` (bereits die reale
   `applicationId` dieser App)
3. `google-services.json` herunterladen → nach `android/app/google-services.json` legen — dieser Pfad
   ist bereits durch `.gitignore` geschützt (siehe Commit zur Vermeidung versehentlicher
   Keystore-/Credential-Commits während des Store-Rollouts), und `android/app/build.gradle` wendet das
   `google-services`-Gradle-Plugin bereits **bedingt** an, sobald diese Datei existiert
   (`android/app/build.gradle:46-53`) — keine Gradle-Änderung nötig, das Plugin ist bereits
   vorbereitet und wartet nur auf die Datei.
4. Service-Account-JSON generieren (Firebase-Konsole → Projekteinstellungen → Dienstkonten → neuer
   privater Schlüssel) → Inhalt als `FIREBASE_SERVICE_ACCOUNT_JSON` in `.env` auf DEV- und
   PROD-Server hinterlegen (siehe Server-seitig oben für alle Stellen, die diese Variable kennen
   müssen).

## Nicht Teil dieses Designs

- iOS/APNs — bewusst ausgeklammert (siehe Scope-Grenze oben).
- Kein Rich-Media (Bilder/Actions) in Push-Benachrichtigungen — nur Titel/Text/`data.url`, wie beim
  bestehenden Web Push auch.
- Kein Migrations-/Umstellungspfad von Web Push zu FCM für bestehende Nutzer — beide Mechanismen
  koexistieren dauerhaft nebeneinander, kein "Ablösen".

## Build-Auswirkung

Dieses Feature ändert die native Hülle (neues Plugin, `google-services.json`, neue Gradle-Plugin-
Aktivierung) — **braucht einen neuen, signierten Android-Build** vor dem nächsten Store-Upload, anders
als reine Web-Code-Änderungen.

## Verifizierung

Wie beim ursprünglichen Capacitor-Store-Rollout: kein automatisierter Test-Suite in diesem Repo, und
native Push-Zustellung/Berechtigungs-Dialoge/Tap-Navigation sind inhärent geräteabhängig — nicht im
Browser-Automatisierungs-Tool testbar. Verifizierung erfolgt durch `tsc`/`next build` für jede
Code-Änderung, dann einen manuellen Durchlauf auf einem echten Android-Gerät (Berechtigung erteilen,
Token wird gespeichert bestätigen, Test-Push von News oder einem Kalender-Termin auslösen, Empfang im
Vorder- und Hintergrund prüfen, Tap-Navigation zum richtigen Ziel bestätigen).
