/** OAuth-Fehler (RFC 6749 §5.2): `code` ist der `error`-Wert, `message` die `error_description`. */
export class OauthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'OauthError';
  }
}
