import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Identische Endpunkt/Region-Ableitung wie lib/system/s3-check.ts - beide Buckets liegen im
 * selben Exoscale-Account/derselben Zone, nur der Bucket-Name unterscheidet sich. */
function regionFromEndpoint(endpointUrl: string): string {
  const match = endpointUrl.match(/^https?:\/\/sos-([^.]+)\.exo\.io/);
  return match?.[1] ?? 'us-east-1';
}

let cachedClient: S3Client | null = null;

export function getIncidentPhotosS3Client(): S3Client {
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

function getPhotosBucket(): string {
  const bucket = process.env.S3_PHOTOS_BUCKET;
  if (!bucket) throw new Error('S3_PHOTOS_BUCKET ist nicht konfiguriert.');
  return bucket;
}

/** Presigned PUT für den direkten Client->S3-Upload des Originals - 15 Minuten Gültigkeit (deutlich
 * länger als die 60 Sekunden der Download-URLs unten), da ein 50-MB-Original über eine langsame
 * mobile Verbindung realistisch mehrere Minuten braucht. */
export async function presignPhotoUpload(storageKey: string, contentType: string): Promise<string> {
  const client = getIncidentPhotosS3Client();
  const command = new PutObjectCommand({ Bucket: getPhotosBucket(), Key: storageKey, ContentType: contentType });
  return getSignedUrl(client, command, { expiresIn: 900 });
}

/** Presigned GET für Downloads/Vorschauen - siehe Foto-Upload-Brief.md §4.2: NIE eine dauerhafte
 * URL, jede Anfrage geht über die session-geprüfte Route (Task 4), die diese Funktion erst NACH der
 * Berechtigungsprüfung aufruft. 60 Sekunden reichen für den unmittelbaren 307-Redirect. */
export async function presignPhotoDownload(storageKey: string, options?: { contentDisposition?: string }): Promise<string> {
  const client = getIncidentPhotosS3Client();
  const command = new GetObjectCommand({
    Bucket: getPhotosBucket(),
    Key: storageKey,
    ResponseContentDisposition: options?.contentDisposition,
  });
  return getSignedUrl(client, command, { expiresIn: 60 });
}

export async function headPhotoObject(storageKey: string): Promise<{ contentLength: number } | null> {
  const client = getIncidentPhotosS3Client();
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: getPhotosBucket(), Key: storageKey }));
    return { contentLength: result.ContentLength ?? 0 };
  } catch {
    return null;
  }
}

export async function getPhotoObjectBytes(storageKey: string): Promise<Buffer> {
  const client = getIncidentPhotosS3Client();
  const result = await client.send(new GetObjectCommand({ Bucket: getPhotosBucket(), Key: storageKey }));
  const chunks: Uint8Array[] = [];
  // @aws-sdk/client-s3's Body ist im Node-Laufzeitkontext ein Readable-Stream, kein Web-Stream.
  for await (const chunk of result.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function putPreviewObject(storageKey: string, body: Buffer, contentType: string): Promise<void> {
  const client = getIncidentPhotosS3Client();
  await client.send(new PutObjectCommand({ Bucket: getPhotosBucket(), Key: storageKey, Body: body, ContentType: contentType }));
}

/** Löscht bis zu drei Objekte (Original + zwei Vorschauen) in einem Aufruf - DeleteObjects statt
 * dreier einzelner DeleteObject-Aufrufe. Nicht existierende Schlüssel verursachen keinen Fehler
 * (S3-Semantik), daher ist kein vorheriges HeadObject nötig. */
export async function deletePhotoObjects(storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return;
  const client = getIncidentPhotosS3Client();
  await client.send(
    new DeleteObjectsCommand({
      Bucket: getPhotosBucket(),
      Delete: { Objects: storageKeys.map((Key) => ({ Key })) },
    }),
  );
}
