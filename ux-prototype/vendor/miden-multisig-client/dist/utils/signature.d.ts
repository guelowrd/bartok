import { AdviceMap, Felt, Signature, Word } from '@miden-sdk/miden-sdk';
import type { ProposalSignatureEntry, SignatureScheme } from '../types.js';
export declare const ECDSA_AUTH_SCHEME_ID = 1;
export declare const FALCON_AUTH_SCHEME_ID = 2;
export declare function signatureHexToBytes(hex: string, scheme?: SignatureScheme): Uint8Array;
export declare function buildSignatureAdviceEntry(pubkeyCommitment: Word, message: Word, signature: Signature, ecdsaPubkeyHex?: string, ecdsaSigHex?: string): {
    key: Word;
    values: Felt[];
};
export declare function tryComputeEcdsaCommitmentHex(pubkeyHex: string): string | null;
export declare function tryComputeCommitmentHex(pubkeyHex: string, scheme: SignatureScheme): string | null;
export declare function verifyEcdsaCommitment(pubkeyHex: string, expectedCommitmentHex: string): {
    match: boolean;
    computedHex: string;
    packedFelts: string[];
    error?: string;
};
export declare function mergeSignatureAdviceMaps(advice: AdviceMap, entries: Array<{
    key: Word;
    values: Felt[];
}>): AdviceMap;
export declare function toWord(hex: string): Word;
export declare function normalizeSignerCommitment(signerId: string): string;
export declare function canonicalizeSignature(signature: ProposalSignatureEntry, signerCommitments: Set<string>): ProposalSignatureEntry;
//# sourceMappingURL=signature.d.ts.map