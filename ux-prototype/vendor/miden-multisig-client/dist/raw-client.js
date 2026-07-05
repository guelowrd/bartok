import { WasmWebClient, } from '@miden-sdk/miden-sdk';
export const DEFAULT_MIDEN_RPC_URL = 'https://rpc.devnet.miden.io';
const rawClientCache = new WeakMap();
export function resolveMidenRpcEndpoint(endpoint) {
    return endpoint ?? DEFAULT_MIDEN_RPC_URL;
}
function isPublicMidenClient(client) {
    return 'accounts' in client && 'sync' in client;
}
export async function getRawMidenClient(client, rpcUrl) {
    if (!isPublicMidenClient(client)) {
        return client;
    }
    const cached = rawClientCache.get(client);
    if (cached) {
        return cached;
    }
    const rawClient = WasmWebClient.createClient(resolveMidenRpcEndpoint(rpcUrl), undefined, undefined, await client.storeIdentifier());
    rawClientCache.set(client, rawClient);
    return rawClient;
}
export function getTransactionProver(client) {
    return isPublicMidenClient(client) ? client.defaultProver : null;
}
export async function compileTxScript(client, code, libraries = [], rpcUrl) {
    if (isPublicMidenClient(client)) {
        return client.compile.txScript({ code, libraries });
    }
    const rawClient = await getRawMidenClient(client, rpcUrl);
    const builder = await rawClient.createCodeBuilder();
    for (const library of libraries) {
        const builtLibrary = builder.buildLibrary(library.namespace, library.code);
        if (library.linking === 'static') {
            builder.linkStaticLibrary(builtLibrary);
        }
        else {
            builder.linkDynamicLibrary(builtLibrary);
        }
    }
    return builder.compileTxScript(code);
}
//# sourceMappingURL=raw-client.js.map