import { AuthDigest } from '../utils/digest.js';
import { EcdsaFormat } from '../utils/ecdsa.js';
import { hexToBytes, uint8ArrayToBase64 } from '../utils/encoding.js';
import { lookupAuthDigest } from '../lookupAuth.js';
import { wordToBytes } from '../utils/word.js';
function extractSignature(response) {
    if (!response || typeof response !== 'object') {
        return null;
    }
    const signature = response.signature;
    return typeof signature === 'string' ? signature : null;
}
export class ParaSigner {
    commitment;
    publicKey;
    scheme = 'ecdsa';
    para;
    walletId;
    constructor(para, walletId, commitment, publicKey) {
        if (!EcdsaFormat.validatePublicKeyHex(publicKey)) {
            throw new Error('Invalid ECDSA public key for ParaSigner');
        }
        this.para = para;
        this.walletId = walletId;
        this.commitment = commitment;
        this.publicKey = EcdsaFormat.compressPublicKey(publicKey);
    }
    async signAccountIdWithTimestamp(accountId, timestamp) {
        const digest = AuthDigest.fromAccountIdWithTimestamp(accountId, timestamp);
        return this.signWord(digest);
    }
    async signRequest(accountId, timestamp, requestPayload) {
        const digest = AuthDigest.fromRequest(accountId, timestamp, requestPayload);
        return this.signWord(digest);
    }
    async signCommitment(commitmentHex) {
        const word = AuthDigest.fromCommitmentHex(commitmentHex);
        return this.signWord(word);
    }
    /**
     * Sign a `LookupAuthMessage` digest for the `/state/lookup` endpoint.
     * Account-less; used directly by `recoverByKey`.
     */
    async signLookupMessage(keyCommitmentHex, timestampMs) {
        const digest = lookupAuthDigest(timestampMs, keyCommitmentHex);
        return this.signWord(digest);
    }
    async signWord(word) {
        const messageBase64 = uint8ArrayToBase64(hexToBytes(EcdsaFormat.keccakDigestHex(wordToBytes(word))));
        const res = await this.para.signMessage({
            walletId: this.walletId,
            messageBase64,
        });
        const signature = extractSignature(res);
        if (!signature) {
            throw new Error('Para signing was denied by user');
        }
        return EcdsaFormat.normalizeRecoveryByte(signature);
    }
}
//# sourceMappingURL=para.js.map