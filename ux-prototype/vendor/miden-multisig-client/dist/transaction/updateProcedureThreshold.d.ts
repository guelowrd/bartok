import { type MidenClient, TransactionRequest, type WasmWebClient, Word } from '@miden-sdk/miden-sdk';
import { type ProcedureName } from '../procedures.js';
import type { SignatureOptions } from './options.js';
export declare function buildUpdateProcedureThresholdTransactionRequest(client: MidenClient | WasmWebClient, procedure: ProcedureName, threshold: number, options?: SignatureOptions): Promise<{
    request: TransactionRequest;
    salt: Word;
    configHash: Word;
}>;
//# sourceMappingURL=updateProcedureThreshold.d.ts.map