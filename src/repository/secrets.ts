/**
 * Secrets guard. Repositories are untrusted input: we never read `.env`-style
 * files into analysis, and we redact anything that looks like a credential
 * before text leaves the scanner (so it never reaches artifacts, logs, or an
 * LLM).
 */

const SECRET_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\..+)?$/i,
  /(^|\/)\.envrc$/i,
  /(^|\/)secrets?\.(json|ya?ml|toml|txt)$/i,
  /(^|\/)credentials?\.(json|ya?ml|toml|txt)$/i,
  /(^|\/)service-?account.*\.json$/i,
  /\.(pem|key|p12|pfx|jks|keystore|asc|gpg|crt|cer)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.docker\/config\.json$/i,
  /(^|\/)terraform\.tfvars$/i,
  /(^|\/)\.htpasswd$/i,
];

export function isSecretFile(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  // `.env.example` / `.env.sample` / `.env.template` are documentation, not secrets — but we still redact their values.
  return SECRET_FILE_PATTERNS.some((re) => re.test(p));
}

export function isSecretTemplateFile(relPath: string): boolean {
  return /(^|\/)\.env\.(example|sample|template|dist|defaults?)$/i.test(relPath.replace(/\\/g, "/"));
}

interface SecretPattern {
  name: string;
  re: RegExp;
}

// Ordered from most specific to least. Values are replaced with `[REDACTED:<name>]`.
const VALUE_PATTERNS: SecretPattern[] = [
  { name: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "aws-access-key", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "github-token", re: /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/g },
  { name: "openai-key", re: /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "stripe-key", re: /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: "slack-token", re: /\bxox[abpors]-[A-Za-z0-9-]{10,}\b/g },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "supabase-key", re: /\bsbp_[A-Za-z0-9]{20,}\b/g },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi },
  {
    name: "url-credentials",
    re: /\b([a-z][a-z0-9+.-]*):\/\/([^\s/:@]+):([^\s/@]{3,})@/gi,
  },
  {
    name: "assignment",
    // KEY=value / "key": "value" / key: value where KEY looks secret-ish and value is long enough
    re: /((?:api[_-]?key|apikey|secret|token|passw(?:or)?d|private[_-]?key|access[_-]?key|client[_-]?secret|auth[_-]?token|credential|database[_-]?url|db[_-]?password)[A-Za-z0-9_-]*\s*["']?\s*[:=]\s*["']?)([^\s"',;]{6,})/gi,
  },
];

export interface RedactionResult {
  text: string;
  count: number;
  kinds: string[];
}

/** Redact secret-looking values from text. Safe to call on any file content. */
export function redactSecrets(text: string): RedactionResult {
  let count = 0;
  const kinds = new Set<string>();
  let out = text;
  for (const { name, re } of VALUE_PATTERNS) {
    out = out.replace(re, (...m: string[]) => {
      count++;
      kinds.add(name);
      if (name === "assignment") return `${m[1]}[REDACTED:${name}]`;
      if (name === "url-credentials") return `${m[1]}://[REDACTED:${name}]@`;
      return `[REDACTED:${name}]`;
    });
  }
  return { text: out, count, kinds: Array.from(kinds) };
}

/** Detect whether a string still contains something secret-looking (used in the quality gate). */
export function looksLikeSecret(text: string): boolean {
  return VALUE_PATTERNS.some(({ re, name }) => {
    if (name === "assignment") return false; // too broad for freeform prose
    re.lastIndex = 0;
    return re.test(text);
  });
}
