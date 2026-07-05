import { type MidenClient, TransactionRequest, type WasmWebClient, Word } from '@miden-sdk/miden-sdk';
import type { SignatureOptions } from './options.js';
export declare function buildUpdateSignersTransactionRequest(client: MidenClient | WasmWebClient, threshold: number, signerCommitments: string[], options?: SignatureOptions): Promise<{
    request: TransactionRequest;
    salt: Word;
    configHash: Word;
}>;
//# sourceMappingURL=updateSigners.d.ts.map