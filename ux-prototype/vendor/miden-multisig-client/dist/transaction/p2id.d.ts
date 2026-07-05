import type { TransactionRequest, Word } from '@miden-sdk/miden-sdk';
import type { SignatureOptions } from './options.js';
export declare function deriveP2idSerialNumber(salt: Word): Word;
export declare function buildP2idTransactionRequest(senderId: string, recipientId: string, faucetId: string, amount: bigint, options?: SignatureOptions): {
    request: TransactionRequest;
    salt: Word;
};
//# sourceMappingURL=p2id.d.ts.map