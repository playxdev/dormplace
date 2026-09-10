/**
 * Secrets, merged into the generated `Env`.
 *
 * `worker-configuration.d.ts` is rewritten by `npm run types` from
 * wrangler.jsonc, and secrets are not in wrangler.jsonc — that is the point of
 * them. Declaring them here survives regeneration.
 *
 *   npx wrangler secret put DATA_MASTER_KEY   # 32 random bytes, base64
 *   npx wrangler secret put PII_PEPPER        # 32 random bytes, base64
 *
 * Neither has a default and neither may be committed. The app refuses to write
 * personal data without them rather than storing it in the clear.
 */
interface Env {
  /** Wraps every per-subject data key. Rotating it means rewrapping `data_key`. */
  DATA_MASTER_KEY: string;
  /** HMAC pepper for phone and email matching hashes. Effectively permanent. */
  PII_PEPPER: string;
}
