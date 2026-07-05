import type { RequestAuthPayload } from '@openzeppelin/guardian-client';
import { Word } from '@miden-sdk/miden-sdk';
export declare class AuthDigest {
    static fromAccountIdWithTimestamp(accountId: string, timestamp: number): Word;
    static fromRequest(accountId: string, timestamp: number, requestPayload: RequestAuthPayload): Word;
    private static fromAccountIdTimestampAndPayloadWord;
    static fromCommitmentHex(commitmentHex: string): Word;
    private static emptyPayloadWord;
    private static payloadWordFromBytes;
}
//# sourceMappingURL=digest.d.ts.map