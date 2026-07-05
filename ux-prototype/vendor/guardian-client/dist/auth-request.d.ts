export declare class RequestAuthPayload {
    private readonly canonicalJson;
    private constructor();
    static fromRequest(requestPayload: unknown): RequestAuthPayload;
    toCanonicalJson(): string;
    toBytes(): Uint8Array;
    private static normalizeJson;
    private static canonicalizeJson;
}
//# sourceMappingURL=auth-request.d.ts.map