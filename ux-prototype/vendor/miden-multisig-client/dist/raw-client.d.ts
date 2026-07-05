import { MidenClient, type TransactionProver, type TransactionScript, WasmWebClient } from '@miden-sdk/miden-sdk';
export declare const DEFAULT_MIDEN_RPC_URL = "https://rpc.devnet.miden.io";
export type RawClientSource = MidenClient | WasmWebClient;
export interface ScriptLibrarySource {
    namespace: string;
    code: string;
    linking?: 'dynamic' | 'static';
}
export declare function resolveMidenRpcEndpoint(endpoint?: string): string;
export declare function getRawMidenClient(client: RawClientSource, rpcUrl?: string): Promise<WasmWebClient>;
export declare function getTransactionProver(client: RawClientSource): TransactionProver | null;
export declare function compileTxScript(client: RawClientSource, code: string, libraries?: ScriptLibrarySource[], rpcUrl?: string): Promise<TransactionScript>;
//# sourceMappingURL=raw-client.d.ts.map