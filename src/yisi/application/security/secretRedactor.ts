/**
 * Secret redaction for logs and provider error messages (v0.9 security).
 * Redacts known secret values (API keys from provider config / environment)
 * and common secret-shaped patterns so keys never leak into the Output channel,
 * session files, or surfaced error text. Pure and dependency-free.
 */
export interface SecretRedactor {
  /** Replace any occurrence of the given secret values with [REDACTED]. */
  redactValues(text: string, values: readonly string[]): string;
  /** Redact secret-shaped substrings (Authorization, api_key, sk-...). */
  censor(text: string): string;
  /** Both: exact values then common patterns. */
  redact(text: string, values: readonly string[]): string;
  /** True when the string looks like it likely carries a secret (for checks). */
  likelySecret(value: string): boolean;
}

const REDACTED = '[REDACTED]';

const SECRET_PATTERNS: Array<{ pattern: RegExp; replace: string }> = [
  // Authorization: Bearer <token>
  { pattern: /(Authorization:\s*Bearer\s+)[^\s"']+/gi, replace: '$1' + REDACTED },
  // <key>=<value> where key looks like an api/token/secret/key
  { pattern: /(\b(?:api[_-]?key|token|secret|password|access[_-]?key)\s*[=:]\s*)[^\s"']+/gi, replace: '$1' + REDACTED },
  // sk-<token> (OpenAI-style)
  { pattern: /(sk-)[A-Za-z0-9_-]{8,}/g, replace: '$1' + REDACTED },
  // Bearer token without the scheme
  { pattern: /([^A-Za-z0-9_-])[A-Za-z0-9_-]{32,}([^A-Za-z0-9_-]|$)/g, replace: '$1' + REDACTED + '$2' }
];

const SECRET_KEY_HINT = /(api[_-]?key|token|secret|password|authorization|bearer|sk-)/i;

export function createSecretRedactor(): SecretRedactor {
  return {
    redactValues(text, values) {
      let out = text;
      for (const value of values) {
        if (value && value.length >= 4) {
          out = splitAndJoin(out, value);
        }
      }
      return out;
    },
    censor(text) {
      let out = text;
      for (const entry of SECRET_PATTERNS) out = out.replace(entry.pattern, entry.replace);
      return out;
    },
    redact(text, values) {
      return this.censor(this.redactValues(text, values));
    },
    likelySecret(value) {
      return SECRET_KEY_HINT.test(value);
    }
  };
}

function splitAndJoin(text: string, value: string): string {
  // Split on the literal value so replacement never surprises on regex meta chars.
  return text.split(value).join(REDACTED);
}
