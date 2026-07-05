import type { ConfigureRequest, ConfigureResponse, DeltaObject, DeltaProposalRequest, DeltaProposalResponse, ExecutionDelta, LookupResponse, PubkeyResponse, PushDeltaResponse, SignProposalRequest, SignatureScheme, Signer, StateObject, StatusResponse } from './types.js';
/**
 * Error thrown by the GUARDIAN HTTP client.
 */
export declare class GuardianHttpError extends Error {
    readonly status: number;
    readonly statusText: string;
    readonly body: string;
    constructor(status: number, statusText: string, body: string);
}
/**
 * Minimal HTTP client for GUARDIAN server.
 */
export declare class GuardianHttpClient {
    private signer;
    private readonly baseUrl;
    private lastTimestamp;
    constructor(baseUrl: string);
    /**
     * Monotonic timestamp for auth headers. Strictly increasing across calls
     * within a single client instance so concurrent or rapid-fire requests
     * never produce duplicate `x-timestamp` values.
     */
    private nextTimestamp;
    setSigner(signer: Signer): void;
    getPubkey(scheme?: SignatureScheme): Promise<PubkeyResponse>;
    getStatus(): Promise<StatusResponse>;
    configure(request: ConfigureRequest): Promise<ConfigureResponse>;
    getState(accountId: string): Promise<StateObject>;
    /**
     * Resolve a public-key commitment to the set of account IDs whose
     * authorization set contains it. Authentication is by proof-of-possession:
     * the configured signer MUST hold the private key behind `keyCommitmentHex`
     * and implement `signLookupMessage`. Returns an empty list when the
     * commitment is not authorized for any account.
     */
    lookupAccountByKeyCommitment(keyCommitmentHex: string): Promise<LookupResponse>;
    getDeltaProposals(accountId: string): Promise<DeltaObject[]>;
    getDeltaProposal(accountId: string, commitment: string): Promise<DeltaObject>;
    pushDeltaProposal(request: DeltaProposalRequest): Promise<DeltaProposalResponse>;
    signDeltaProposal(request: SignProposalRequest): Promise<DeltaObject>;
    pushDelta(delta: ExecutionDelta): Promise<PushDeltaResponse>;
    getDelta(accountId: string, nonce: number): Promise<DeltaObject>;
    getDeltaSince(accountId: string, fromNonce: number): Promise<DeltaObject>;
    private fetch;
    /**
     * Authenticated fetch for the lookup endpoint. Cannot reuse
     * `fetchAuthenticated`, which builds an `AuthRequestPayload` bound to an
     * `accountId` (the value lookup is trying to discover). Digest construction
     * is delegated to the signer's `signLookupMessage`.
     */
    private fetchLookupAuthenticated;
    private fetchAuthenticated;
}
//# sourceMappingURL=http.d.ts.map