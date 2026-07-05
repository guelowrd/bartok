import type { MultisigConfig } from '../types.js';
import { StorageSlot } from '@miden-sdk/miden-sdk';
export declare class StorageLayoutBuilder {
    buildMultisigSlots(config: MultisigConfig): StorageSlot[];
    buildGuardianSlots(config: MultisigConfig): StorageSlot[];
}
export declare function buildMultisigStorageSlots(config: MultisigConfig): StorageSlot[];
export declare function buildGuardianStorageSlots(config: MultisigConfig): StorageSlot[];
export declare const storageLayoutBuilder: StorageLayoutBuilder;
//# sourceMappingURL=storage.d.ts.map