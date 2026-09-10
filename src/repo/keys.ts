/**
 * Per-subject data keys (`data_key`), the mechanism behind crypto-shredding.
 *
 * Global, not tenant-scoped: a key belongs to a person, and the same person may
 * be a party at two different operators. It is still the repository layer's job
 * because it is the only thing here that talks to the database — `lib/crypto.ts`
 * holds the key material and no SQL at all.
 *
 * Erasing someone (STANDARD §12.3) is one write against this table. Every field
 * and every R2 object encrypted under that key becomes permanently unreadable
 * without any of them being touched, which is what makes the promise keepable
 * for data that cannot conveniently be rewritten.
 */

import { newDataKey, openDataKey } from '../lib/crypto';

export class KeyRepo {
  constructor(private readonly d1: D1Database, private readonly master: string) {}

  /**
   * The subject's key, created on first use.
   *
   * A shredded row is not the same as a missing one. Minting a fresh key for an
   * erased person would let new data be written under an identity that is
   * supposed to be gone, so it throws instead.
   */
  async forSubject(subjectId: string): Promise<CryptoKey> {
    const row = await this.d1
      .prepare('SELECT wrapped_key, shredded_at FROM data_key WHERE subject_id = ?')
      .bind(subjectId)
      .first<{ wrapped_key: string; shredded_at: string | null }>();

    if (row?.shredded_at) throw new Error(`data key for ${subjectId} was shredded`);
    if (row) return openDataKey(this.master, row.wrapped_key);

    const { key, wrapped } = await newDataKey(this.master);
    await this.d1
      .prepare('INSERT INTO data_key (subject_id, wrapped_key, created_at) VALUES (?, ?, ?)')
      .bind(subjectId, wrapped, new Date().toISOString())
      .run();
    return key;
  }

  /**
   * Erasure. The ciphertext stays where it is and stops meaning anything.
   *
   * The row is kept rather than deleted so a later read fails loudly instead of
   * quietly creating a new key for someone who asked to be forgotten.
   */
  async shred(subjectId: string): Promise<void> {
    await this.d1
      .prepare("UPDATE data_key SET wrapped_key = '', shredded_at = ? WHERE subject_id = ?")
      .bind(new Date().toISOString(), subjectId)
      .run();
  }
}
