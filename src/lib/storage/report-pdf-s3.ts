import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function regionFromEndpoint(endpointUrl: string): string {
  const match = endpointUrl.match(/^https?:\/\/sos-([^.]+)\.exo\.io/);
  return match?.[1] ?? 'us-east-1';
}

let cachedClient: S3Client | null = null;

function getReportPdfS3Client(): S3Client {
  if (cachedClient) return cachedClient;
  const endpoint = process.env.S3_ENDPOINT_URL;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('S3-Zugangsdaten fehlen (S3_ENDPOINT_URL/S3_ACCESS_KEY/S3_SECRET_KEY).');
  }
  cachedClient = new S3Client({
    endpoint,
    region: regionFromEndpoint(endpoint),
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cachedClient;
}

function getReportsBucket(): string {
  const bucket = process.env.S3_REPORTS_BUCKET;
  if (!bucket) throw new Error('S3_REPORTS_BUCKET ist nicht konfiguriert.');
  return bucket;
}

/** Tätigkeitsberichte sind offizielle Dokumente und werden DAUERHAFT aufbewahrt - bewusst ein eigener
 * Bucket (S3_REPORTS_BUCKET), niemals S3_PHOTOS_BUCKET, damit die 96-Stunden-Löschung des
 * photo-cleanup-Crons dieses Bucket niemals betreffen kann. */
export async function putReportPdf(storageKey: string, body: Buffer): Promise<void> {
  const client = getReportPdfS3Client();
  await client.send(
    new PutObjectCommand({ Bucket: getReportsBucket(), Key: storageKey, Body: body, ContentType: 'application/pdf' }),
  );
}

export async function presignReportPdfDownload(storageKey: string): Promise<string> {
  const client = getReportPdfS3Client();
  const command = new GetObjectCommand({ Bucket: getReportsBucket(), Key: storageKey });
  return getSignedUrl(client, command, { expiresIn: 60 });
}
