import { AccountId } from '@miden-sdk/miden-sdk';
import { getRawMidenClient } from '../raw-client.js';
export async function executeForSummary(client, accountId, txRequest, midenRpcEndpoint) {
    const acc = AccountId.fromHex(accountId);
    const rawClient = await getRawMidenClient(client, midenRpcEndpoint);
    return rawClient.executeForSummary(acc, txRequest);
}
//# sourceMappingURL=summary.js.map