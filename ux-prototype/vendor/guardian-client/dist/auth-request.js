export class RequestAuthPayload {
    canonicalJson;
    constructor(canonicalJson) {
        this.canonicalJson = canonicalJson;
    }
    static fromRequest(requestPayload) {
        const normalized = RequestAuthPayload.normalizeJson(requestPayload);
        const canonical = RequestAuthPayload.canonicalizeJson(normalized);
        return new RequestAuthPayload(JSON.stringify(canonical));
    }
    toCanonicalJson() {
        return this.canonicalJson;
    }
    toBytes() {
        return new TextEncoder().encode(this.canonicalJson);
    }
    static normalizeJson(value) {
        if (value === undefined) {
            return null;
        }
        return JSON.parse(JSON.stringify(value));
    }
    static canonicalizeJson(value) {
        if (Array.isArray(value)) {
            return value.map((item) => RequestAuthPayload.canonicalizeJson(item));
        }
        if (value && typeof value === 'object') {
            const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
            const normalized = {};
            for (const [key, item] of entries) {
                normalized[key] = RequestAuthPayload.canonicalizeJson(item);
            }
            return normalized;
        }
        return value;
    }
}
//# sourceMappingURL=auth-request.js.map