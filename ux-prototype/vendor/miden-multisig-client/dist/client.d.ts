/**
 * MultisigClient - Factory for creating and loading multisig accounts.
 *
 * This is the main entry point for the multisig SDK. It provides methods
 * to create new multisig accounts and load existing ones.
 */
import { type MidenClient } from '@miden-sdk/miden-sdk';
import { GuardianHttpClient } from '@openzeppelin/guardian-client';
import type { StateObject } from '@openzeppelin/guardian-client';
import { Multisig } from './multisig.js';
import type { MultisigConfig, Signer } from './types.js';
/**
 * Configuration for MultisigClient.
 */
export interface MultisigClientConfig {
    /** GUARDIAN server endpoint */
    guardianEndpoint?: string;
    /** Miden node RPC endpoint used for state commitment verification */
    midenRpcEndpoint?: string;
}
/**
 * One match returned by `MultisigClient.recoverByKey`. Pairs the discovered
 * `accountId` with the current `state` snapshot so callers do not need to do a
 * second round-trip per account.
 */
export interface RecoveredAccount {
    accountId: string;
    state: StateObject;
}
/**
 * Client for creating and loading multisig accounts.
 *
 * @example
 * ```typescript
 * import { MultisigClient, FalconSigner } from '@openzeppelin/miden-multisig-client';
 * import { MidenClient, AuthSecretKey } from '@miden-sdk/miden-sdk';
 *
 * // Initialize
 * const midenClient = await MidenClient.createDevnet();
 * const secretKey = AuthSecretKey.rpoFalconWithRNG(seed);
 * const signer = new FalconSigner(secretKey);
 *
 * // Create client
 * const client = new MultisigClient(midenClient, {
 *   guardianEndpoint: 'http://localhost:3000',
 *   midenRpcEndpoint: 'https://rpc.devnet.miden.io',
 * });
 *
 * // Get GUARDIAN pubkey for config
 * const guardianCommitment = await client.guardianClient.getPubkey();
 *
 * // Create multisig
 * const config = { threshold: 2, signerCommitments: [...], guardianCommitment };
 * const multisig = await client.create(config, signer);
 * ```
 */
export declare class MultisigClient {
    private readonly midenClient;
    private readonly midenRpcEndpoint;
    private _guardianClient;
    constructor(midenClient: MidenClient, config?: MultisigClientConfig);
    /**
     * Change the GUARDIAN endpoint.
     *
     * @param endpoint - The new GUARDIAN server endpoint URL
     */
    setGuardianEndpoint(endpoint: string): void;
    /**
     * Access the internal GUARDIAN client.
     */
    get guardianClient(): GuardianHttpClient;
    /**
     * Recover the set of accounts a given signer authorizes by querying
     * Guardian's `/state/lookup` endpoint and fetching state for each match.
     * Returns `(accountId, state)` pairs; an empty array means no account on
     * this operator authorizes the commitment (distinct from "wrong key",
     * which would fail authentication first).
     *
     * @throws if `signer` does not implement `signLookupMessage`. The bundled
     *   `FalconSigner` and `EcdsaSigner` both do.
     */
    recoverByKey(signer: Signer): Promise<RecoveredAccount[]>;
    /**
     * Create a new multisig account.
     *
     * @param config - Multisig configuration (threshold, signers, GUARDIAN commitment)
     * @param signer - The signer for this client (one of the cosigners)
     * @returns A Multisig instance wrapping the created account
     */
    create(config: MultisigConfig, signer: Signer): Promise<Multisig>;
    /**
     * Load an existing multisig account from GUARDIAN.
     *
     * @param accountId - The account ID to load
     * @param signer - The signer for this client
     * @returns A Multisig instance for the loaded account
     */
    load(accountId: string, signer: Signer): Promise<Multisig>;
}
//# sourceMappingURL=client.d.ts.map