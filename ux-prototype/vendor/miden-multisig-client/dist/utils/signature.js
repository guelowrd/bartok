import { Felt, FeltArray, Poseidon2, Word } from '@miden-sdk/miden-sdk';
import * as midenSdk from '@miden-sdk/miden-sdk';
import { hexToBytes, normalizeHexWord } from './encoding.js';
export const ECDSA_AUTH_SCHEME_ID = 1;
export const FALCON_AUTH_SCHEME_ID = 2;
function authSchemeId(scheme) {
    return scheme === 'ecdsa' ? ECDSA_AUTH_SCHEME_ID : FALCON_AUTH_SCHEME_ID;
}
export function signatureHexToBytes(hex, scheme = 'falcon') {
    const sigBytes = hexToBytes(hex);
    const withPrefix = new Uint8Array(sigBytes.length + 1);
    withPrefix[0] = authSchemeId(scheme);
    withPrefix.set(sigBytes, 1);
    return withPrefix;
}
function bytesToPackedU32Felts(bytes) {
    const felts = [];
    for (let i = 0; i < bytes.length; i += 4) {
        let packed = 0;
        for (let j = 0; j < 4 && i + j < bytes.length; j += 1) {
            packed |= bytes[i + j] << (j * 8);
        }
        felts.push(new Felt(BigInt(packed >>> 0)));
    }
    return felts;
}
function encodeEcdsaSignatureFelts(pubkeyBytes, sigBytes) {
    const pkFelts = bytesToPackedU32Felts(pubkeyBytes);
    const sigFelts = bytesToPackedU32Felts(sigBytes);
    return [...pkFelts, ...sigFelts];
}
export function buildSignatureAdviceEntry(pubkeyCommitment, message, signature, ecdsaPubkeyHex, ecdsaSigHex) {
    const elements = new FeltArray([
        ...pubkeyCommitment.toFelts(),
        ...message.toFelts(),
    ]);
    const key = Poseidon2.hashElements(elements);
    let values;
    if (ecdsaPubkeyHex && ecdsaSigHex) {
        const pkBytes = hexToBytes(ecdsaPubkeyHex);
        const sigBytes = hexToBytes(ecdsaSigHex);
        values = encodeEcdsaSignatureFelts(pkBytes, sigBytes);
    }
    else {
        values = signature.toPreparedSignature(message);
    }
    return { key, values };
}
export function tryComputeEcdsaCommitmentHex(pubkeyHex) {
    return tryComputeCommitmentHex(pubkeyHex, 'ecdsa');
}
export function tryComputeCommitmentHex(pubkeyHex, scheme) {
    const bytes = hexToBytes(pubkeyHex);
    const withPrefix = new Uint8Array(bytes.length + 1);
    withPrefix[0] = authSchemeId(scheme);
    withPrefix.set(bytes, 1);
    try {
        const { PublicKey } = midenSdk;
        const instance = PublicKey.deserialize(withPrefix);
        return normalizeHexWord(instance.toCommitment().toHex());
    }
    catch {
        return null;
    }
}
export function verifyEcdsaCommitment(pubkeyHex, expectedCommitmentHex) {
    try {
        const bytes = hexToBytes(pubkeyHex);
        const packedU32Values = [];
        for (let i = 0; i < bytes.length; i += 4) {
            let packed = 0;
            for (let j = 0; j < 4 && i + j < bytes.length; j += 1) {
                packed |= bytes[i + j] << (j * 8);
            }
            packedU32Values.push(packed >>> 0);
        }
        const packedFelts = bytesToPackedU32Felts(bytes);
        const feltArray = new FeltArray(packedFelts);
        const computed = Poseidon2.hashElements(feltArray);
        const computedHex = normalizeHexWord(computed.toHex());
        const expectedNorm = normalizeHexWord(expectedCommitmentHex);
        return {
            match: computedHex === expectedNorm,
            computedHex,
            packedFelts: packedU32Values.map((value) => value.toString()),
        };
    }
    catch (error) {
        return {
            match: false,
            computedHex: `ERROR: ${error}`,
            packedFelts: [],
            error: String(error),
        };
    }
}
export function mergeSignatureAdviceMaps(advice, entries) {
    for (const entry of entries) {
        advice.insert(entry.key, new FeltArray(entry.values));
    }
    return advice;
}
export function toWord(hex) {
    return Word.fromHex(normalizeHexWord(hex));
}
export function normalizeSignerCommitment(signerId) {
    const hex = signerId.startsWith('0x') || signerId.startsWith('0X')
        ? signerId.slice(2)
        : signerId;
    if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
        throw new Error(`expected signerId as 32-byte hex, got ${signerId}`);
    }
    return normalizeHexWord(signerId);
}
export function canonicalizeSignature(signature, signerCommitments) {
    try {
        const signerId = normalizeSignerCommitment(signature.signerId);
        if (!signerCommitments.has(signerId)) {
            throw new Error(`signer ${signerId} is not part of this multisig`);
        }
        return {
            ...signature,
            signerId,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
    }
}
//# sourceMappingURL=signature.js.map