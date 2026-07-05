import { type MidenClient, TransactionRequest, type WasmWebClient, Word } from '@miden-sdk/miden-sdk';
import type { SignatureOptions } from './options.js';
export declare function buildUpdateGuardianTransactionRequest(client: MidenClient | WasmWebClient, newGuardianPubkey: string, options?: SignatureOptions): Promise<{
    request: TransactionRequest;
    salt: Word;
}>;
//# sourceMappingURL=updateGuardian.d.ts.map