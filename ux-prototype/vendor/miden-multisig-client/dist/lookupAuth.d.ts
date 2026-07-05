import { Word } from '@miden-sdk/miden-sdk';
/**
 * Compute the digest a lookup-bound signer signs.
 *
 * Layout (must mirror `LookupAuthMessage::to_word` in `crates/shared`):
 *
 * ```text
 * RPO256_hash([
 *   DOMAIN_TAG_W0, DOMAIN_TAG_W1, DOMAIN_TAG_W2, DOMAIN_TAG_W3,
 *   timestamp_ms_felt,
 *   key_commitment_W0, key_commitment_W1,
 *   key_commitment_W2, key_commitment_W3,
 * ])
 * ```
 *
 * @param timestampMs Unix milliseconds. Reinterpreted as `u64` to match the
 *                    Rust `as u64` cast (so negative inputs wrap into the high
 *                    range), then reduced mod the Goldilocks prime via
 *                    `feltFromU64Reduced` (Miden 0.15's `Felt` constructor
 *                    rejects non-canonical inputs instead of reducing).
 * @param keyCommitmentHex `0x`-prefixed 32-byte hex string for the queried
 *                         commitment.
 */
export declare function lookupAuthDigest(timestampMs: number | bigint, keyCommitmentHex: string): Word;
/**
 * Reset the cached domain tag. Tests use this to exercise the cache miss path;
 * production callers should not need it.
 */
export declare function _resetLookupDomainTagCacheForTesting(): void;
//# sourceMappingURL=lookupAuth.d.ts.map