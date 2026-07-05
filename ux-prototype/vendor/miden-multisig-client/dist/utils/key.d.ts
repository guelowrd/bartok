import type { SignatureScheme } from '../types.js';
export declare class PublicKeyFormat {
    static parse(publicKey: Uint8Array): {
        scheme: SignatureScheme;
        publicKeyHex: string;
        commitment: string | null;
    };
    static wordBytesToHex(bytes: Uint8Array): string;
}
//# sourceMappingURL=key.d.ts.map