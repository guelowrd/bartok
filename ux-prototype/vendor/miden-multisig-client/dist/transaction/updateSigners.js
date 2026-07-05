import { AdviceMap, Felt, FeltArray, Poseidon2, TransactionRequestBuilder, Word as WordType, } from '@miden-sdk/miden-sdk';
import { MULTISIG_ECDSA_MASM, MULTISIG_MASM, } from '../account/masm/auth.js';
import { compileTxScript } from '../raw-client.js';
import { normalizeHexWord } from '../utils/encoding.js';
import { randomWord } from '../utils/random.js';
function buildMultisigConfigFelts(threshold, signerCommitments) {
    const numApprovers = signerCommitments.length;
    const felts = [
        new Felt(BigInt(threshold)),
        new Felt(BigInt(numApprovers)),
        new Felt(0n),
        new Felt(0n),
    ];
    for (const commitment of [...signerCommitments].reverse()) {
        const word = WordType.fromHex(normalizeHexWord(commitment));
        felts.push(...word.toFelts());
    }
    return felts;
}
function buildMultisigConfigAdvice(threshold, signerCommitments) {
    // `Poseidon2.hashElements` consumes (frees) its `FeltArray` by value, so the
    // advice payload must be a freshly built one — reusing the hashed array
    // surfaces as "null pointer passed to rust" at the later `advice.insert`.
    const configHash = Poseidon2.hashElements(new FeltArray(buildMultisigConfigFelts(threshold, signerCommitments)));
    const payload = new FeltArray(buildMultisigConfigFelts(threshold, signerCommitments));
    return { configHash, payload };
}
async function buildUpdateSignersScript(client, signatureScheme, midenRpcEndpoint) {
    const multisigMasm = signatureScheme === 'ecdsa' ? MULTISIG_ECDSA_MASM : MULTISIG_MASM;
    const scriptSource = `
use oz_multisig::multisig

begin
    call.multisig::update_signers_and_threshold
end
  `;
    return compileTxScript(client, scriptSource, [{ namespace: 'oz_multisig::multisig', code: multisigMasm }], midenRpcEndpoint);
}
export async function buildUpdateSignersTransactionRequest(client, threshold, signerCommitments, options = {}) {
    const signatureScheme = options.signatureScheme ?? 'falcon';
    const { configHash: configHashForAdvice, payload } = buildMultisigConfigAdvice(threshold, signerCommitments);
    const { configHash: configHashForScript } = buildMultisigConfigAdvice(threshold, signerCommitments);
    const { configHash: configHashForReturn } = buildMultisigConfigAdvice(threshold, signerCommitments);
    const advice = new AdviceMap();
    advice.insert(configHashForAdvice, payload);
    const script = await buildUpdateSignersScript(client, signatureScheme, options.midenRpcEndpoint);
    const authSaltHex = options.salt ? options.salt.toHex() : randomWord().toHex();
    const authSaltForBuilder = WordType.fromHex(normalizeHexWord(authSaltHex));
    let txBuilder = new TransactionRequestBuilder();
    txBuilder = txBuilder.withCustomScript(script);
    txBuilder = txBuilder.withScriptArg(configHashForScript);
    txBuilder = txBuilder.extendAdviceMap(advice);
    txBuilder = txBuilder.withAuthArg(authSaltForBuilder);
    if (options.signatureAdviceMap) {
        txBuilder = txBuilder.extendAdviceMap(options.signatureAdviceMap);
    }
    const authSaltForReturn = WordType.fromHex(normalizeHexWord(authSaltHex));
    return {
        request: txBuilder.build(),
        salt: authSaltForReturn,
        configHash: configHashForReturn,
    };
}
//# sourceMappingURL=updateSigners.js.map