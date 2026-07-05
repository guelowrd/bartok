import { Felt } from '@miden-sdk/miden-sdk';
/**
 * Maps an arbitrary `u64` onto a canonical field element by reducing modulo the
 * field order, mirroring `guardian_shared::felt::felt_from_u64_reduced`.
 *
 * Miden 0.15's `Felt` constructor rejects non-canonical inputs (values
 * `>= FELT_ORDER`), whereas 0.14 reduced silently. Byte-packed digest inputs are
 * arbitrary `u64`s, so reducing here preserves the original digest layout, keeps
 * construction infallible, and stays byte-identical to server-side signing.
 */
export declare function feltFromU64Reduced(value: bigint): Felt;
//# sourceMappingURL=felt.d.ts.map