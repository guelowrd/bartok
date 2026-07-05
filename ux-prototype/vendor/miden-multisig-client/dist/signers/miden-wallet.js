import { AuthDigest } from '../utils/digest.js';
import { bytesToHex } from '../utils/encoding.js';
import { lookupAuthDigest } from '../lookupAuth.js';
import { wordToBytes } from '../utils/word.js';
export class MidenWalletSigner {
    commitment;
    publicKey;
    scheme;
    wallet;
    localAuthSigner;
    constructor(wallet, commitment, scheme, localAuthSigner, publicKey) {
        this.wallet = wallet;
        this.commitment = commitment;
        this.scheme = scheme;
        this.localAuthSigner = localAuthSigner ?? null;
        this.publicKey = publicKey ?? localAuthSigner?.publicKey ?? commitment;
    }
    async signAccountIdWithTimestamp(accountId, timestamp) {
        if (this.localAuthSigner) {
            return this.localAuthSigner.signAccountIdWithTimestamp(accountId, timestamp);
        }
        const word = AuthDigest.fromAccountIdWithTimestamp(accountId, timestamp);
        return this.signWord(word);
    }
    async signRequest(accountId, timestamp, requestPayload) {
        if (this.localAuthSigner?.signRequest) {
            return this.localAuthSigner.signRequest(accountId, timestamp, requestPayload);
        }
        if (this.scheme === 'falcon') {
            return this.signWord(AuthDigest.fromRequest(accountId, timestamp, requestPayload));
        }
        return this.signWord(AuthDigest.fromRequest(accountId, timestamp, requestPayload));
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
        if (this.localAuthSigner?.signLookupMessage) {
            return this.localAuthSigner.signLookupMessage(keyCommitmentHex, timestampMs);
        }
        const digest = lookupAuthDigest(timestampMs, keyCommitmentHex);
        return this.signWord(digest);
    }
    async signWord(word) {
        const bytes = wordToBytes(word);
        const signatureBytes = await this.wallet.signBytes(bytes, 'word');
        const rawSignature = signatureBytes.slice(1);
        return bytesToHex(rawSignature);
    }
}
//# sourceMappingURL=miden-wallet.js.map