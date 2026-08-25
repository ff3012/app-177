import { Footer } from '@/components/layout/footer';

export const metadata = { title: 'Datenschutzerklärung — APP-17' };

export default function DatenschutzPage() {
  return (
    <div className="pt-safe pb-safe-tabbar flex min-h-screen flex-col bg-[#f6f6f7]">
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 text-sm leading-relaxed text-neutral-800">
        <h1 className="mb-6 text-2xl font-semibold text-neutral-900">Datenschutzerklärung</h1>

        <p className="mb-4">
          Diese App (&bdquo;APP-17&ldquo;) wird vom Bezirksfeuerwehrkommando St. Pölten für Mitglieder der
          Freiwilligen Feuerwehren im Bezirk 17 St. Pölten bereitgestellt. Diese Erklärung beschreibt, welche
          personenbezogenen Daten verarbeitet werden und zu welchem Zweck.
        </p>

        <p className="mb-4">
          Die App enthält keine Werbung, kein Tracking zu Werbezwecken und keine Analyse-Dienste von
          Drittanbietern. Es werden keine Daten zu Werbezwecken verkauft oder weitergegeben.
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Verantwortlicher</h2>
        <p className="mb-4">
          Bezirksfeuerwehrkommando St. Pölten
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Datenschutzbeauftragter</h2>
        <p className="mb-4">
          Florian Krebs ABI
          <br />
          Freiwillige Feuerwehr Wolfsgraben
          <br />
          Wehrerstrasse 1
          <br />
          3012 Wolfsgraben
          <br />
          florian.krebs@feuerwehr.gv.at
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Welche Daten werden verarbeitet</h2>
        <ul className="mb-4 list-disc pl-5">
          <li>Konto- und Profildaten: Name, E-Mail-Adresse, Telefonnummer, Dienstgrad, Standesbuchnummer, Heimatfeuerwehr.</li>
          <li>Nutzungsdaten der Feuerwehr-Module: Kalendereinträge, Drohnenflug-Protokolle, Fahrzeug-Reservierungen, hochgeladene Einsatz-/Übungsfotos.</li>
          <li>Technische Daten: Push-Benachrichtigungs-Endpunkte (nur bei aktivierter Benachrichtigungsfunktion), Zeitpunkt der letzten Anmeldung.</li>
        </ul>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Auftragsverarbeiter</h2>
        <ul className="mb-4 list-disc pl-5">
          <li>Hetzner Online GmbH — Server-Hosting (Deutschland/EU).</li>
          <li>Mailjet — E-Mail-Versand (Frankreich/EU).</li>
          <li>Exoscale — S3 Storage (Österreich/EU).</li>
        </ul>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Übermittlung in Drittländer</h2>
        <p className="mb-4">
          Wenn Push-Benachrichtigungen aktiviert werden, erfolgt die technische Zustellung über den
          jeweiligen Push-Dienst des verwendeten Browsers bzw. Betriebssystems (z. B. Google Firebase Cloud
          Messaging oder Apple Push Notification Service). Dabei werden das Push-Kennzeichen des Geräts und
          der Inhalt der Benachrichtigung übermittelt; dies kann eine Übermittlung in die USA einschließen.
          Alle übrigen in dieser Erklärung genannten Auftragsverarbeiter verarbeiten Daten ausschließlich
          innerhalb der EU.
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Zweck der Verarbeitung</h2>
        <p className="mb-4">
          Die Daten dienen ausschließlich der internen Organisation der Feuerwehren im Bezirk 17 (Terminplanung,
          Drohnengruppen-Verwaltung, Fahrzeug-Reservierung, Atemschutz-Nachweis, Fotodokumentation). Es findet
          keine Weitergabe an Dritte zu Werbezwecken statt. Die Nutzung obliegt den einzelnen Drohnengruppen sowie
          Heimatfeuerwehren.
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Speicherdauer</h2>
        <p className="mb-4">
          Daten werden für die Dauer der Mitgliedschaft bzw. bis zur Deaktivierung des Zugangs gespeichert und
          können auf Anfrage gelöscht werden, soweit keine gesetzliche Aufbewahrungspflicht entgegensteht.
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Rechte der Nutzer</h2>
        <p className="mb-4">
          Jedes Mitglied hat das Recht auf Auskunft, Berichtigung und Löschung der eigenen Daten. Anfragen bitte
          an obige Kontaktadresse.
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Beschwerderecht</h2>
        <p className="mb-4">
          Jedes Mitglied hat das Recht, sich bei der österreichischen Datenschutzbehörde
          (www.dsb.gv.at) über die Verarbeitung seiner personenbezogenen Daten zu beschweren.
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Datensicherheit</h2>
        <p className="mb-4">
          Die Übertragung erfolgt ausschließlich verschlüsselt über TLS. Passwörter werden nur als
          kryptografischer Hash gespeichert, niemals im Klartext.
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Cookies und lokale Speicherung</h2>
        <p className="mb-4">
          Die Weboberfläche verwendet ausschließlich ein technisch notwendiges Sitzungs-Cookie, das für die
          Anmeldung erforderlich ist. Es werden keine Cookies zu Analyse- oder Werbezwecken gesetzt.
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Keine automatisierte Entscheidungsfindung</h2>
        <p className="mb-4">
          Es findet keine automatisierte Entscheidungsfindung einschließlich Profiling statt.
        </p>
      </div>
      <Footer />
    </div>
  );
}
