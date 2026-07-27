interface SendEmailParams {
  to: string;
  toName?: string;
  subject: string;
  textPart: string;
  htmlPart: string;
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const apiKey = process.env.MAILJET_API_KEY;
  const apiSecret = process.env.MAILJET_API_SECRET;
  const fromEmail = process.env.MAILJET_FROM_EMAIL;
  const fromName = process.env.MAILJET_FROM_NAME ?? 'AFKDO Purkersdorf';

  if (!apiKey || !apiSecret || !fromEmail) {
    throw new Error(
      'Mailjet ist nicht konfiguriert (MAILJET_API_KEY / MAILJET_API_SECRET / MAILJET_FROM_EMAIL fehlen).',
    );
  }

  const response = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
    },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: fromEmail, Name: fromName },
          To: [{ Email: params.to, Name: params.toName ?? params.to }],
          Subject: params.subject,
          TextPart: params.textPart,
          HTMLPart: params.htmlPart,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mailjet-Versand fehlgeschlagen (${response.status}): ${body}`);
  }
}
