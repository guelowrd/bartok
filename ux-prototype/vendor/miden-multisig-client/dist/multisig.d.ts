/**
 * Multisig class representing a created or loaded multisig account.
 *
 * This class wraps a Miden SDK Account and provides GUARDIAN integration
 * for proposal management.
 */
import { GuardianHttpClient, type Signer } from '@openzeppelin/guardian-client';
import type { ConsumableNote, ExportedProposal, MultisigConfig, Proposal, ProposalMetadata, ProposalType } from './types.js';
import type { ProcedureName } from './procedures.js';
import type { MidenClient } from '@miden-sdk/miden-sdk';
import { Account, AdviceMap, TransactionRequest } from '@miden-sdk/miden-sdk';
/**
 * Result of fetching account state from GUARDIAN.
 */
export interface AccountState {
    /** Account ID */
    accountId: string;
    /** Current commitment */
    commitment: string;
    /** Raw state data (base64-encoded serialized account) */
    stateDataBase64: string;
    createdAt: string;
    updatedAt: string;
}
export interface AccountStateVerificationResult {
    accountId: string;
    localCommitment: string;
    onChainCommitment: string;
}
export declare class Multisig {
    account: Account;
    threshold: number;
    signerCommitments: string[];
    guardianCommitment: string;
    procedureThresholds: Map<ProcedureName, number>;
    guardianPublicKey?: string;
    private guardian;
    private readonly signer;
    private readonly midenClient;
    private readonly rawClientPromise;
    private readonly transactionProver;
    private readonly _accountId;
    private readonly midenRpcEndpoint?;
    private proposals;
    constructor(account: Account, config: MultisigConfig, guardian: GuardianHttpClient, signer: Signer, midenClient: MidenClient, accountId?: string, midenRpcEndpoint?: string);
    private getMidenRpcEndpoint;
    private getRawClient;
    private proposalFactory;
    private verifyGuardianEndpointCommitment;
    /** The account ID as a string */
    get accountId(): string;
    /** The signer's commitment */
    get signerCommitment(): string;
    /**
     * Maps a proposal type to the procedure that determines its threshold.
     */
    private getProposalProcedure;
    /**
     * Get the effective threshold for a given proposal type.
     * Returns the procedure-specific threshold if configured, otherwise the default threshold.
     *
     * @param proposalType - The type of proposal
     * @returns The threshold that applies to this proposal type
     */
    getEffectiveThreshold(proposalType: ProposalType): number;
    /**
     * Update the GUARDIAN client used by this Multisig instance.
     *
     * @param guardianClient - The new GUARDIAN HTTP client
     */
    setGuardianClient(guardianClient: GuardianHttpClient): void;
    /**
     * Fetch the current account state from GUARDIAN.
     *
     * @returns The account state including commitment and serialized data
     */
    fetchState(): Promise<AccountState>;
    /**
     * Sync account state from GUARDIAN into the local Miden client store.
     *
     * If the GUARDIAN commitment differs from the local commitment (or the account
     * is missing locally), the local store is overwritten with the GUARDIAN state.
     */
    syncState(): Promise<AccountState>;
    verifyStateCommitment(): Promise<AccountStateVerificationResult>;
    private ensureSafeToOverwriteLocalState;
    private getOnChainCommitment;
    private refreshConfigFromAccount;
    /**
     * Register this multisig account on the GUARDIAN server.
     *
     * The initial state must be the serialized Account bytes (base64-encoded).
     * If not provided, the account's serialize() method is used.
     *
     * @param initialStateBase64 - Optional base64-encoded serialized Account.¡
     */
    registerOnGuardian(initialStateBase64?: string): Promise<void>;
    /**
     * Sync proposals from the GUARDIAN server.
     */
    syncProposals(): Promise<Proposal[]>;
    /**
     * List all known proposals
     */
    listProposals(): Proposal[];
    /**
     * Create a new proposal.
     *
     * @param nonce - The nonce for this transaction
     * @param txSummaryBase64 - Base64-encoded transaction summary
     * @param metadata - Optional metadata for execution (target config, salt, etc.)
     */
    createProposal(nonce: number, txSummaryBase64: string, metadata: ProposalMetadata): Promise<Proposal>;
    /**
     * Create an "add signer" proposal.
     *
     * @param newCommitment - Commitment of the new signer (hex)
     * @param nonce - Optional proposal nonce (defaults to Date.now())
     * @param newThreshold - Optional new threshold (defaults to current threshold)
     */
    createAddSignerProposal(newCommitment: string, nonce?: number, newThreshold?: number): Promise<Proposal>;
    /**
     * Create a "remove signer" proposal by executing the update_signers script to summary.
     *
     * @param signerToRemove - Commitment of the signer to remove (hex)
     * @param nonce - Optional proposal nonce (defaults to Date.now())
     * @param newThreshold - Optional new threshold (defaults to min of current threshold and new signer count)
     */
    createRemoveSignerProposal(signerToRemove: string, nonce?: number, newThreshold?: number): Promise<Proposal>;
    /**
     * Create a "change threshold" proposal.
     *
     * @param newThreshold - The new threshold value
     * @param nonce - Optional proposal nonce (defaults to Date.now())
     */
    createChangeThresholdProposal(newThreshold: number, nonce?: number): Promise<Proposal>;
    createUpdateProcedureThresholdProposal(targetProcedure: ProcedureName, targetThreshold: number, nonce?: number): Promise<Proposal>;
    /**
     * Create a "switch GUARDIAN" proposal to change the GUARDIAN provider.
     *
     * @param newGuardianEndpoint - The new GUARDIAN server endpoint URL
     * @param newGuardianPubkey - The new GUARDIAN server's public key commitment (hex)
     * @param nonce - Optional proposal nonce (defaults to Date.now())
     */
    createSwitchGuardianProposal(newGuardianEndpoint: string, newGuardianPubkey: string, nonce?: number): Promise<Proposal>;
    /**
     * Create a "consume notes" proposal to consume notes sent to the multisig account.
     *
     * @param noteIds - IDs of the notes to consume (hex strings)
     * @param nonce - Optional proposal nonce (defaults to Date.now())
     */
    createConsumeNotesProposal(noteIds: string[], nonce?: number): Promise<Proposal>;
    /**
     * Create a P2ID proposal to send funds to another account.
     *
     * @param recipientId - Account ID of the recipient (hex string)
     * @param faucetId - Faucet/token account ID (hex string)
     * @param amount - Amount to send
     * @param nonce - Optional proposal nonce (defaults to Date.now())
     */
    createP2idProposal(recipientId: string, faucetId: string, amount: bigint, nonce?: number): Promise<Proposal>;
    /**
     * Get notes that can be consumed by this multisig account.
     *
     * Returns a list of notes that are committed on-chain and can be consumed
     * immediately by the multisig account.
     */
    getConsumableNotes(): Promise<ConsumableNote[]>;
    /**
     * Sign a proposal.
     *
     * The proposalId is the tx_summary commitment hex, which is what gets signed.
     * This matches the Rust client behavior where proposal.id == tx_summary.to_commitment().
     *
    * @param proposalId - The proposal commitment/ID (this is also what gets signed)
    */
    signProposal(proposalId: string): Promise<Proposal>;
    private getProposalForSigning;
    createTransactionProposalRequest(proposalId: string): Promise<TransactionRequest>;
    /**
     * Execute a proposal that has enough signatures.
     *
     * @param proposalId - The proposal commitment/ID
     */
    executeProposal(proposalId: string): Promise<void>;
    /**
     * Submit an integration-built transaction (advice already injected). Mirrors
     * the Rust `submit_transaction`; used by the custom proposal producer flow
     * after `prepareCustomExecution` rebuilds its request with the returned advice.
     */
    submitTransaction(request: TransactionRequest): Promise<void>;
    /**
     * BARTOK addition (PR-able): submit a custom proposal from its serialized
     * request bytes + the advice from `prepareCustomExecution`, rebuilding the
     * request inside THIS package's SDK instance. Lets integrations avoid
     * constructing SDK objects (Felt/Note/etc.) in their own bundle — critical
     * when the app and this linked package would otherwise fork two WASM
     * instances (mismatched Felt classes). Deterministic: same bytes + advice.
     */
    submitCustomFromBytes(transactionRequestBytes: Uint8Array, advice: AdviceMap): Promise<void>;
    /**
     * Create a proposal from a producer-built transaction the SDK does not model
     * (issue #266 producer API). `transactionRequestBytes` is a serialized TransactionRequest;
     * `proposalType` is a free-form, non-empty label that must not collide with a
     * built-in type. The integration keeps its own recipe to execute later via
     * `prepareCustomExecution`.
     */
    createCustomProposal(transactionRequestBytes: Uint8Array, proposalType: string, nonce?: number): Promise<Proposal>;
    /**
     * Assemble the validated execution advice (cosigner signatures + GUARDIAN
     * acknowledgment) for a ready custom proposal, so an integration can rebuild
     * its transaction with its own recipe and submit (issue #266 producer API).
     *
     * `transactionRequestBytes` is the serialized transaction request; it is used only to verify
     * (binding check) that it reproduces the signed commitment, before the
     * acknowledgment is requested. Returns the advice the integration folds into
     * its rebuilt transaction (`builder.extendAdviceMap(advice)`).
     */
    prepareCustomExecution(proposalId: string, transactionRequestBytes: Uint8Array): Promise<AdviceMap>;
    private assembleCustomAdvice;
    private getLocalProposal;
    private prepareProposalExecution;
    /**
     * Export a proposal for offline signing
     */
    exportProposal(proposalId: string): Promise<ExportedProposal>;
    /**
     * Export a proposal to JSON for side-channel sharing.
     *
     * @param proposalId - The proposal commitment/ID
     * @returns JSON string that can be shared and imported by other signers
     */
    exportProposalToJson(proposalId: string): string;
    /**
     * Import a proposal from JSON (exported via exportProposalToJson).
     *
     * @param json - JSON string from exportProposalToJson
     * @returns The imported proposal
     */
    importProposal(json: string): Promise<Proposal>;
    /**
     * Sign an imported proposal and return updated JSON for sharing..
     *
     * @param proposalId - The proposal commitment/ID
     * @returns Updated JSON string with the new signature included
     */
    signProposalOffline(proposalId: string): Promise<string>;
    private ensureProposalCommitmentMatchesSummary;
    private verifyProposalMetadataBinding;
    private buildTransactionRequestFromMetadata;
}
//# sourceMappingURL=multisig.d.ts.map