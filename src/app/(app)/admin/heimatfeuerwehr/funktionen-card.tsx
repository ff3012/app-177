import { FeatureToggleRow } from './feature-toggle-row';

interface FunktionenCardProps {
  organizationId: string;
  featureAtemschutz: boolean;
  featureFacebook: boolean;
  membersErfasstCount: number;
  featuresUpdatedAt: Date | null;
  featuresUpdatedByName: string | null;
  facebookPageId: string | null;
  hasFacebookToken: boolean;
  facebookLastFetchAt: Date | null;
  facebookLastFetchError: string | null;
}

function formatUpdatedMeta(updatedAt: Date | null, updatedByName: string | null): string | undefined {
  if (!updatedAt || !updatedByName) return undefined;
  return `zuletzt geändert ${updatedAt.toLocaleDateString('de-AT')} durch ${updatedByName}`;
}

export function FunktionenCard({
  organizationId,
  featureAtemschutz,
  featureFacebook,
  membersErfasstCount,
  featuresUpdatedAt,
  featuresUpdatedByName,
  facebookPageId,
  hasFacebookToken,
  facebookLastFetchAt,
  facebookLastFetchError,
}: FunktionenCardProps) {
  const updatedMeta = formatUpdatedMeta(featuresUpdatedAt, featuresUpdatedByName);
  const atemschutzMeta = [`${membersErfasstCount} Mitglieder erfasst`, updatedMeta].filter(Boolean).join(' · ');

  const facebookMeta =
    featureFacebook && hasFacebookToken
      ? [
          `Verbunden mit facebook.com/${facebookPageId}`,
          facebookLastFetchError
            ? `Fehler beim letzten Abruf: ${facebookLastFetchError}`
            : facebookLastFetchAt
              ? `zuletzt abgerufen ${facebookLastFetchAt.toLocaleString('de-AT', { hour: '2-digit', minute: '2-digit' })}`
              : undefined,
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined;

  return (
    <div className="rounded-lg bg-surface shadow-card">
      <div className="px-6 py-5">
        <h2 className="mb-1 text-[17px] font-semibold text-ink">Funktionen</h2>
        <p className="text-sm text-ink-faint">
          Bestimmt, was die Mitglieder dieser Feuerwehr sehen. Abgeschaltete Module werden ausgeblendet -
          bereits erfasste Daten bleiben vollständig erhalten und erscheinen wieder, sobald das Modul
          aktiviert wird.
        </p>
      </div>

      <FeatureToggleRow
        organizationId={organizationId}
        feature="ATEMSCHUTZ"
        title="Modul Atemschutzgeräteträger"
        description="Zeigt Untersuchung und Finnentest unter „Meine Feuerwehr“ und aktiviert die Atemschutz-Liste in dieser Verwaltung."
        enabled={featureAtemschutz}
        meta={atemschutzMeta}
        confirmTitle="Modul Atemschutzgeräteträger abschalten?"
        confirmDescription={`Die ${membersErfasstCount} Mitglieder dieser Feuerwehr sehen den Atemschutz-Bereich unter „Meine Feuerwehr“ nicht mehr. Die Atemschutz-Liste verschwindet auch aus dieser Verwaltung.`}
        confirmNote="Alle erfassten Untersuchungen und Finnentests bleiben gespeichert und erscheinen unverändert, sobald das Modul wieder aktiviert wird."
      />

      <FeatureToggleRow
        organizationId={organizationId}
        feature="FACEBOOK"
        title="Facebook-Integration Dashboard"
        description="Blendet die letzten Beiträge der Facebook-Seite auf dem Dashboard im Feuerwehrhaus ein."
        enabled={featureFacebook}
        disabled={!hasFacebookToken}
        meta={facebookMeta}
        disabledHint="Kein Zugangstoken hinterlegt. Zum Aktivieren wird ein Facebook-Seitentoken benötigt."
        confirmTitle="Facebook-Integration abschalten?"
        confirmDescription="Das Facebook-Widget verschwindet vom Dashboard im Feuerwehrhaus. Zugangsdaten bleiben gespeichert."
        confirmNote="Der Zugriffstoken bleibt hinterlegt und muss beim Wiedereinschalten nicht neu eingegeben werden."
      />
    </div>
  );
}
