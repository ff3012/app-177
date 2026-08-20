interface SendEmailParams {
  to: string;
  toName?: string;
  /** Bislang nur von der Fahrzeug-Reservierungs-Ergebnis-Mail genutzt (An: Ausborger, Cc: die
   * hinterlegte Freigabe-Adresse, damit sie die Entscheidung ebenfalls im Blick hat). */
  cc?: string[];
  subject: string;
  textPart: string;
  htmlPart: string;
}

/** Erzwingt an einer einzigen Stelle dieselbe Schriftart/-größe für den gesamten Inhalt jeder
 * E-Mail - einzelne Vorlagen setzen sonst leicht inkonsistente Inline-Styles nur an manchen
 * Absätzen (z. B. eine kleinere Fußnote), was im Mailclient wie ein Stilbruch aussieht. Ein
 * Web-Font wie das Barlow der App wäre in E-Mail-Clients unzuverlässig (kein @font-face-Support),
 * daher eine Standard-Sans-Serif-Stack statt der App-Schrift. Absichtliche Ausnahmen (z. B. der
 * größere, monospaced Anmelde-Code in sendLoginTokenEmail) überschreiben das per eigenem
 * Inline-Style weiterhin gezielt - das bleibt möglich, da Inline-Styles auf dem Kind-Element
 * gegenüber dem hier vererbten Wert gewinnen. */
function wrapHtmlPart(htmlPart: string): string {
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.5; color: #1c1c1e;">${htmlPart}</div>`;
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const apiKey = process.env.MAILJET_API_KEY;
  const apiSecret = process.env.MAILJET_API_SECRET;
  const fromEmail = process.env.MAILJET_FROM_EMAIL;
  const fromName = process.env.MAILJET_FROM_NAME ?? 'BFKDO St. Pölten';

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
          ...(params.cc && params.cc.length > 0 ? { Cc: params.cc.map((email) => ({ Email: email })) } : {}),
          Subject: params.subject,
          TextPart: params.textPart,
          HTMLPart: wrapHtmlPart(params.htmlPart),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mailjet-Versand fehlgeschlagen (${response.status}): ${body}`);
  }
}

/** Prüft nur Konfiguration + Auth gegen die Mailjet-API (liest die eigenen API-Key-Infos) – versendet keine E-Mail. */
export async function checkMailjetConnection(): Promise<boolean> {
  const apiKey = process.env.MAILJET_API_KEY;
  const apiSecret = process.env.MAILJET_API_SECRET;
  const fromEmail = process.env.MAILJET_FROM_EMAIL;

  if (!apiKey || !apiSecret || !fromEmail) return false;

  try {
    const response = await fetch(`https://api.mailjet.com/v3/REST/apikey/${apiKey}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}
