import { AccountId } from '@miden-sdk/miden-sdk';
import { bytesToHex, normalizeHexWord } from '../utils/encoding.js';
import { AuthDigest } from '../utils/digest.js';
import { lookupAuthDigest } from '../lookupAuth.js';
export class EcdsaSigner {
    commitment;
    publicKey;
    scheme = 'ecdsa';
    secretKey;
    publicKeyCommitment;
    constructor(secretKey) {
        this.secretKey = secretKey;
        const pubKey = secretKey.publicKey();
        const serialized = pubKey.serialize();
        this.publicKey = bytesToHex(serialized.slice(1));
        this.publicKeyCommitment = pubKey.toCommitment();
        this.commitment = normalizeHexWord(this.publicKeyCommitment.toHex());
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
    async bindAccountKey(midenClient, accountId) {
        const targetAccountId = AccountId.fromHex(accountId);
        const existingAccountId = await midenClient.keystore.getAccountId(this.publicKeyCommitment);
        if (existingAccountId) {
            if (existingAccountId.toString().toLowerCase() === accountId.toLowerCase()) {
                return;
            }
            throw new Error(`Signer commitment ${this.commitment} is already bound to account ${existingAccountId.toString()}`);
        }
        await midenClient.keystore.insert(targetAccountId, this.secretKey);
    }
    signWord(word) {
        const signature = this.secretKey.sign(word);
        const signatureBytes = signature.serialize();
        const ecdsaSignature = signatureBytes.slice(1);
        return bytesToHex(ecdsaSignature);
    }
}
//# sourceMappingURL=ecdsa.js.map