import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';

/** Exoscale SOS-Endpunkte haben die Form https://sos-<zone>.exo.io - die Zone ist zugleich die von
 * ihrer S3-kompatiblen API für SigV4-Signierung erwartete "region". Kein fixer Default möglich, da
 * die Zone je Deployment unterschiedlich ist (siehe S3_ENDPOINT_URL in .env.example). */
function regionFromEndpoint(endpointUrl: string): string {
  const match = endpointUrl.match(/^https?:\/\/sos-([^.]+)\.exo\.io/);
  return match?.[1] ?? 'us-east-1';
}

/** Prüft nur Erreichbarkeit + Zugangsdaten gegen den konfigurierten S3-Bucket (HeadBucket, liest/
 * schreibt keine Objekte) - analog zu checkMailjetConnection in lib/email/mailjet.ts. Liefert false
 * sowohl wenn S3-Backup nicht konfiguriert ist (S3_BACKUP_BUCKET fehlt, optional laut
 * docker/backup.sh) als auch bei einem echten Verbindungs-/Auth-Fehler - dieselbe simple
 * Boolean-Semantik wie bei Mailjet, keine dritte Detailunterscheidung nötig. */
export async function checkS3Connection(): Promise<boolean> {
  const bucket = process.env.S3_BACKUP_BUCKET;
  const endpoint = process.env.S3_ENDPOINT_URL;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return false;

  const client = new S3Client({
    endpoint,
    region: regionFromEndpoint(endpoint),
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch {
    return false;
  }
}
