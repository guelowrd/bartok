import type { ProposalMetadata as GuardianProposalMetadata } from '@openzeppelin/guardian-client';
import type { ProposalMetadata } from '../types.js';
export declare class ProposalMetadataCodec {
    static toGuardian(metadata: ProposalMetadata): GuardianProposalMetadata;
    static fromGuardian(guardian?: GuardianProposalMetadata): ProposalMetadata;
    static validate(metadata: ProposalMetadata): ProposalMetadata;
}
//# sourceMappingURL=metadata.d.ts.map