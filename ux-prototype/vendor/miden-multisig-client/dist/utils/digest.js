import { AccountId, Felt, FeltArray, Rpo256, Word } from '@miden-sdk/miden-sdk';
import { feltFromU64Reduced } from './felt.js';
export class AuthDigest {
    static fromAccountIdWithTimestamp(accountId, timestamp) {
        const paddedHex = accountId.startsWith('0x') ? accountId : `0x${accountId}`;
        const parsedAccountId = AccountId.fromHex(paddedHex);
        const prefix = parsedAccountId.prefix();
        const suffix = parsedAccountId.suffix();
        const feltArray = new FeltArray([
            prefix,
            suffix,
            feltFromU64Reduced(BigInt(timestamp)),
            new Felt(0n),
        ]);
        return Rpo256.hashElements(feltArray);
    }
    static fromRequest(accountId, timestamp, requestPayload) {
        return AuthDigest.fromAccountIdTimestampAndPayloadWord(accountId, timestamp, AuthDigest.payloadWordFromBytes(requestPayload.toBytes()));
    }
    static fromAccountIdTimestampAndPayloadWord(accountId, timestamp, payloadWord) {
        const paddedHex = accountId.startsWith('0x') ? accountId : `0x${accountId}`;
        const parsedAccountId = AccountId.fromHex(paddedHex);
        const prefix = parsedAccountId.prefix();
        const suffix = parsedAccountId.suffix();
        const feltArray = new FeltArray([
            prefix,
            suffix,
            feltFromU64Reduced(BigInt(timestamp)),
            ...payloadWord.toFelts(),
        ]);
        return Rpo256.hashElements(feltArray);
    }
    static fromCommitmentHex(commitmentHex) {
        const paddedHex = commitmentHex.startsWith('0x') ? commitmentHex : `0x${commitmentHex}`;
        const cleanHex = paddedHex.slice(2).padStart(64, '0');
        return Word.fromHex(`0x${cleanHex}`);
    }
    static emptyPayloadWord() {
        return Word.fromHex(`0x${'0'.repeat(64)}`);
    }
    static payloadWordFromBytes(bytes) {
        if (bytes.length === 0) {
            return AuthDigest.emptyPayloadWord();
        }
        const payloadElements = [];
        for (let i = 0; i < bytes.length; i += 8) {
            let packed = 0n;
            for (let j = 0; j < 8 && i + j < bytes.length; j += 1) {
                packed |= BigInt(bytes[i + j]) << (8n * BigInt(j));
            }
            payloadElements.push(feltFromU64Reduced(packed));
        }
        return Rpo256.hashElements(new FeltArray(payloadElements));
    }
}
//# sourceMappingURL=digest.js.map