import type { RequestAuthPayload } from '@openzeppelin/guardian-client';
import type { Signer, SignatureScheme } from '../types.js';
export interface ParaSigningContext {
    signMessage(params: {
        walletId: string;
        messageBase64: string;
    }): Promise<unknown>;
}
export declare class ParaSigner implements Signer {
    readonly commitment: string;
    readonly publicKey: string;
    readonly scheme: SignatureScheme;
    private readonly para;
    private readonly walletId;
    constructor(para: ParaSigningContext, walletId: string, commitment: string, publicKey: string);
    signAccountIdWithTimestamp(accountId: string, timestamp: number): Promise<string>;
    signRequest(accountId: string, timestamp: number, requestPayload: RequestAuthPayload): Promise<string>;
    signCommitment(commitmentHex: string): Promise<string>;
    /**
     * Sign a `LookupAuthMessage` digest for the `/state/lookup` endpoint.
     * Account-less; used directly by `recoverByKey`.
     */
    signLookupMessage(keyCommitmentHex: string, timestampMs: number): Promise<string>;
    private signWord;
}
//# sourceMappingURL=para.d.ts.map