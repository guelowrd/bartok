import type { MidenClient, TransactionRequest, TransactionSummary, WasmWebClient } from '@miden-sdk/miden-sdk';
export declare function executeForSummary(client: MidenClient | WasmWebClient, accountId: string, txRequest: TransactionRequest, midenRpcEndpoint?: string): Promise<TransactionSummary>;
//# sourceMappingURL=summary.d.ts.map