import { canonicalizeSignature, normalizeSignerCommitment } from '../utils/signature.js';
export class ProposalSignatures {
    signatures;
    constructor(signatures, signerCommitments, context) {
        const expectedSigners = new Set();
        for (const signerCommitment of signerCommitments) {
            let normalizedCommitment;
            try {
                normalizedCommitment = normalizeSignerCommitment(signerCommitment);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`${context}: ${message}`);
            }
            expectedSigners.add(normalizedCommitment);
        }
        const signaturesBySigner = new Map();
        for (const signature of signatures) {
            let canonicalized;
            try {
                canonicalized = canonicalizeSignature(signature, expectedSigners);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`${context}: ${message}`);
            }
            if (signaturesBySigner.has(canonicalized.signerId)) {
                throw new Error(`${context}: duplicate signatures for signer ${canonicalized.signerId}`);
            }
            signaturesBySigner.set(canonicalized.signerId, canonicalized);
        }
        this.signatures = Array.from(signaturesBySigner.values());
    }
    entries() {
        return [...this.signatures];
    }
    count() {
        return this.signatures.length;
    }
    hasSigner(signerId) {
        const normalizedSigner = normalizeSignerCommitment(signerId);
        return this.signatures.some((signature) => signature.signerId === normalizedSigner);
    }
    static mergeEntries(entryGroups) {
        const signaturesBySigner = new Map();
        for (const group of entryGroups) {
            for (const signature of group) {
                signaturesBySigner.set(signature.signerId, signature);
            }
        }
        return Array.from(signaturesBySigner.values());
    }
}
//# sourceMappingURL=signatures.js.map