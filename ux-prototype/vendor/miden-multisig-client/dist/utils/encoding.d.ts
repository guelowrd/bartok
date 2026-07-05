export declare function ensureHexPrefix(hex: string): string;
export declare function normalizeHexWord(hex: string): string;
export declare function bytesToHex(bytes: Uint8Array): string;
export declare function hexToBytes(hex: string): Uint8Array;
export declare function uint8ArrayToBase64(bytes: Uint8Array): string;
/** Serialize a Miden `Note` to base64 (v2 `consume_notes` metadata, issue #229). */
export declare function noteToBase64(note: {
    serialize(): Uint8Array;
}): string;
/** Decode a base64 note. `noteCtor` is `Note` from `@miden-sdk/miden-sdk`. */
export declare function noteFromBase64<TNote>(base64: string, noteCtor: {
    deserialize(bytes: Uint8Array): TNote;
}): TNote;
export declare function base64ToUint8Array(base64: string): Uint8Array;
//# sourceMappingURL=encoding.d.ts.map