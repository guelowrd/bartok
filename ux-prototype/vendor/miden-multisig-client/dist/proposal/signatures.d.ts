import type { ProposalSignatureEntry } from '../types.js';
export declare class ProposalSignatures {
    private readonly signatures;
    constructor(signatures: ProposalSignatureEntry[], signerCommitments: string[], context: string);
    entries(): ProposalSignatureEntry[];
    count(): number;
    hasSigner(signerId: string): boolean;
    static mergeEntries(entryGroups: ProposalSignatureEntry[][]): ProposalSignatureEntry[];
}
//# sourceMappingURL=signatures.d.ts.map