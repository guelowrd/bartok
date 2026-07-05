/**
 * Account Inspector - Inspects account storage to detect multisig configuration.
 */
import { Account } from '@miden-sdk/miden-sdk';
import { type ProcedureName } from './procedures.js';
export interface VaultBalance {
    faucetId: string;
    amount: bigint;
}
export interface DetectedMultisigConfig {
    threshold: number;
    numSigners: number;
    signerCommitments: string[];
    guardianEnabled: boolean;
    guardianCommitment: string | null;
    vaultBalances: VaultBalance[];
    procedureThresholds: Map<ProcedureName, number>;
}
/**
 * Inspects an account to detect its multisig configuration.
 *
 * @example
 * ```typescript
 * // From base64-encoded state
 * const config = AccountInspector.fromBase64(stateDataBase64);
 * console.log(`${config.threshold}-of-${config.numSigners} multisig`);
 *
 * // From Miden SDK Account
 * const config = AccountInspector.fromAccount(account);
 * ```
 */
export declare class AccountInspector {
    private constructor();
    /**
     * Inspect a base64-encoded serialized account.
     *
     * @param base64Data - Base64-encoded Account bytes
     * @returns Detected multisig configuration
     */
    static fromBase64(base64Data: string): DetectedMultisigConfig;
    /**
     * Inspect a Miden SDK Account object.
     *
     * @param account - The Account object from Miden SDK
     * @returns Detected multisig configuration
     */
    static fromAccount(account: Account): DetectedMultisigConfig;
}
//# sourceMappingURL=inspector.d.ts.map