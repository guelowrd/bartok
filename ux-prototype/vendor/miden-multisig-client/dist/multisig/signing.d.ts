import type { ProposalSignature, Signer } from '@openzeppelin/guardian-client';
import type { SignatureScheme } from '../types.js';
export declare function toGuardianSignature(scheme: SignatureScheme, signatureHex: string, publicKey?: string): ProposalSignature;
export declare function buildGuardianSignatureFromSigner(signer: Signer, commitment: string): Promise<ProposalSignature>;
//# sourceMappingURL=signing.d.ts.map