import { headers } from 'next/headers';
import Link from 'next/link';

/**
 * Zwischenseite nach erfolgreichem E-Mail-Token-Login (statt direkt auf /kalender zu leiten):
 * ein per Mail-App geöffneter Link landet immer im normalen Safari-Tab, nie direkt in der bereits
 * am Homescreen installierten App - iOS führt für "Zum Home-Bildschirm"-Apps einen eigenen,
 * von Safari getrennten Speicher-Container. Die Anmeldung in Safari wirkt sich daher nicht
 * automatisch auf eine bereits laufende Homescreen-App-Instanz aus; die muss dafür einmal
 * komplett geschlossen (im App-Umschalter nach oben wischen, nicht nur in den Hintergrund legen)
 * und neu geöffnet werden. Das betrifft gleichermaßen die Aktivierungs- und
 * Passwort-zurücksetzen-Links, nur ist es dort seltener aufgefallen.
 */
export default async function LoginTokenSuccessPage() {
  const headerList = await headers();
  const userAgent = headerList.get('user-agent') ?? '';
  const isIOS = /iphone|ipad|ipod/i.test(userAgent);

  return (
    <div className="pt-safe flex min-h-screen items-center justify-center bg-[#f6f6f7] px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-1 text-xl font-semibold text-neutral-900">Anmeldung erfolgreich</h1>
        <p className="mb-4 text-sm text-neutral-500">Du bist jetzt in diesem Browser angemeldet.</p>

        {isIOS && (
          <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Nutzt du die App vom Homescreen?</p>
            <p className="mt-1">
              Diese Anmeldung wurde hier in Safari durchgeführt und wirkt sich nicht automatisch auf eine bereits
              geöffnete Homescreen-App aus. Schließe die App vollständig (im App-Umschalter nach oben wischen) und
              öffne sie danach über das Symbol am Homescreen erneut.
            </p>
          </div>
        )}

        <Link
          href="/meine-feuerwehr"
          className="inline-block rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark"
        >
          Weiter zu Meine Feuerwehr
        </Link>
      </div>
    </div>
  );
}
