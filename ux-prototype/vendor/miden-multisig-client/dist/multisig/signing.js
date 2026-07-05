export function toGuardianSignature(scheme, signatureHex, publicKey) {
    if (scheme === 'ecdsa') {
        if (!publicKey) {
            throw new Error('ECDSA signature requires publicKey');
        }
        return { scheme: 'ecdsa', signature: signatureHex, publicKey };
    }
    return { scheme: 'falcon', signature: signatureHex };
}
export async function buildGuardianSignatureFromSigner(signer, commitment) {
    const signatureHex = await signer.signCommitment(commitment);
    return toGuardianSignature(signer.scheme, signatureHex, signer.publicKey);
}
//# sourceMappingURL=signing.js.map