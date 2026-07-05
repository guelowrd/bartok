import type { RequestAuthPayload } from '@openzeppelin/guardian-client';
import type { Signer, SignatureScheme } from '../types.js';
export interface WalletSigningContext {
    signBytes(data: Uint8Array, kind: 'word' | 'signingInputs'): Promise<Uint8Array>;
}
export declare class MidenWalletSigner implements Signer {
    readonly commitment: string;
    readonly publicKey: string;
    readonly scheme: SignatureScheme;
    private readonly wallet;
    private readonly localAuthSigner;
    constructor(wallet: WalletSigningContext, commitment: string, scheme: SignatureScheme, localAuthSigner?: Signer, publicKey?: string);
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
//# sourceMappingURL=miden-wallet.d.ts.map