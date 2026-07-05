export declare class EcdsaFormat {
    static normalizeSignatureHex(signatureHex: string): string;
    static normalizeRecoveryByte(signatureHex: string): string;
    static validatePublicKeyHex(publicKeyHex: string): boolean;
    static compressPublicKey(uncompressedHex: string): string;
    static keccakDigestHex(data: Uint8Array): string;
}
//# sourceMappingURL=ecdsa.d.ts.map