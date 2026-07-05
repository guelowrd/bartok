import { Word } from '@miden-sdk/miden-sdk';
export declare function wordToHex(word: Word): string;
export declare function wordElementToBigInt(word: Word, index: number): bigint;
export declare function wordToBytes(word: {
    toFelts: () => Array<{
        asInt: () => bigint;
    }>;
}): Uint8Array;
//# sourceMappingURL=word.d.ts.map