/**
 * Account builder for creating multisig accounts with GUARDIAN authentication.
 *
 * This module provides functionality to create multisig accounts.
 */
import { type MidenClient } from '@miden-sdk/miden-sdk';
import type { MultisigConfig, CreateAccountResult } from '../types.js';
/**
 * Creates a multisig account with GUARDIAN authentication.
 *
 * @param midenClient - Initialized MidenClient
 * @param config - Multisig configuration
 * @returns The created account and seed
 */
export declare function createMultisigAccount(midenClient: MidenClient, config: MultisigConfig, midenRpcEndpoint?: string): Promise<CreateAccountResult>;
/**
 * Validates a multisig configuration.
 *
 * @param config - The configuration to validate
 * @throws Error if configuration is invalid
 */
export declare function validateMultisigConfig(config: MultisigConfig): void;
//# sourceMappingURL=builder.d.ts.map