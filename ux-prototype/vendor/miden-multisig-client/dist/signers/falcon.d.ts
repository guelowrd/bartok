import type { RequestAuthPayload } from '@openzeppelin/guardian-client';
import { AuthSecretKey, type MidenClient } from '@miden-sdk/miden-sdk';
import type { Signer, SignatureScheme } from '../types.js';
export declare class FalconSigner implements Signer {
    readonly commitment: string;
    readonly publicKey: string;
    readonly scheme: SignatureScheme;
    private readonly secretKey;
    private readonly publicKeyCommitment;
    constructor(secretKey: AuthSecretKey);
    signAccountIdWithTimestamp(accountId: string, timestamp: number): Promise<string>;
    signRequest(accountId: string, timestamp: number, requestPayload: RequestAuthPayload): Promise<string>;
    signCommitment(commitmentHex: string): Promise<string>;
    /**
     * Sign a `LookupAuthMessage` digest for the `/state/lookup` endpoint.
     * Account-less; used directly by `recoverByKey`.
     */
    signLookupMessage(keyCommitmentHex: string, timestampMs: number): Promise<string>;
    bindAccountKey(midenClient: MidenClient, accountId: string): Promise<void>;
    private signWord;
}
//# sourceMappingURL=falcon.d.ts.map