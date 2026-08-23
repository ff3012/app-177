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

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Verantwortlicher</h2>
        <p className="mb-4">
          Bezirksfeuerwehrkommando St. Pölten. Kontakt für Datenschutzanfragen:{' '}
          florian.krebs@feuerwehr.gv.at.
        </p>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Welche Daten werden verarbeitet</h2>
        <ul className="mb-4 list-disc pl-5">
          <li>Konto- und Profildaten: Name, E-Mail-Adresse, Telefonnummer, Dienstgrad, Standesbuchnummer, Heimatfeuerwehr.</li>
          <li>Nutzungsdaten der Feuerwehr-Module: Kalendereinträge, Drohnenflug-Protokolle, Fahrzeug-Reservierungen, hochgeladene Einsatz-/Übungsfotos.</li>
          <li>Technische Daten: Push-Benachrichtigungs-Endpunkte (nur bei aktivierter Benachrichtigungsfunktion), Zeitpunkt der letzten Anmeldung.</li>
        </ul>

        <h2 className="mb-2 mt-6 text-lg font-semibold text-neutral-900">Zweck der Verarbeitung</h2>
        <p className="mb-4">
          Die Daten dienen ausschließlich der internen Organisation der Feuerwehren im Bezirk 17 (Terminplanung,
          Drohnengruppen-Verwaltung, Fahrzeug-Reservierung, Atemschutz-Nachweis, Fotodokumentation). Es findet
          keine Weitergabe an Dritte zu Werbezwecken statt.
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
      </div>
      <Footer />
    </div>
  );
}
