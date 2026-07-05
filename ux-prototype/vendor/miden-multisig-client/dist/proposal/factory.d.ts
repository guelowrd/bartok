import type { DeltaObject } from '@openzeppelin/guardian-client';
import type { ExportedProposal, Proposal, ProposalMetadata, ProposalSignatureEntry, ProposalType } from '../types.js';
interface ProposalFactoryOptions {
    accountId: string;
    signerCommitments: string[];
    resolveRequiredSignatures: (proposalType: ProposalType) => number;
}
export declare class ProposalFactory {
    private readonly options;
    constructor(options: ProposalFactoryOptions);
    assertAccountId(accountId: string): void;
    assertCommitmentMatchesTxSummary(commitment: string, txSummaryBase64: string, context: string): string;
    fromDelta(delta: DeltaObject, proposalId: string, metadata?: ProposalMetadata, existingSignatures?: ProposalSignatureEntry[]): Proposal;
    fromExported(exported: ExportedProposal): Proposal;
    private toStatus;
}
export {};
//# sourceMappingURL=factory.d.ts.map