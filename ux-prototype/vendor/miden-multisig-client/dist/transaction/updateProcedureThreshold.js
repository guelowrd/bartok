import { Felt, FeltArray, Poseidon2, TransactionRequestBuilder, Word as WordType, } from '@miden-sdk/miden-sdk';
import { MULTISIG_ECDSA_MASM, MULTISIG_MASM, } from '../account/masm/auth.js';
import { getProcedureRoot } from '../procedures.js';
import { compileTxScript } from '../raw-client.js';
import { normalizeHexWord } from '../utils/encoding.js';
import { randomWord } from '../utils/random.js';
function buildProcedureThresholdFelts(procedure, threshold) {
    const procedureRoot = WordType.fromHex(normalizeHexWord(getProcedureRoot(procedure)));
    return [
        ...procedureRoot.toFelts(),
        new Felt(BigInt(threshold)),
        new Felt(0n),
        new Felt(0n),
        new Felt(0n),
    ];
}
function buildProcedureThresholdAdvice(procedure, threshold) {
    // `Poseidon2.hashElements` consumes (frees) its `FeltArray` by value, so the
    // advice payload must be a freshly built one — reusing the hashed array
    // surfaces as "null pointer passed to rust" at the later `advice.insert`.
    const configHash = Poseidon2.hashElements(new FeltArray(buildProcedureThresholdFelts(procedure, threshold)));
    const payload = new FeltArray(buildProcedureThresholdFelts(procedure, threshold));
    return { configHash, payload };
}
async function buildUpdateProcedureThresholdScript(client, procedure, threshold, signatureScheme, midenRpcEndpoint) {
    const multisigMasm = signatureScheme === 'ecdsa' ? MULTISIG_ECDSA_MASM : MULTISIG_MASM;
    const procedureRoot = normalizeHexWord(getProcedureRoot(procedure));
    const scriptSource = `
use oz_multisig::multisig

begin
    push.${procedureRoot}
    push.${threshold}
    call.multisig::update_procedure_threshold
    dropw
    drop
end
  `;
    return compileTxScript(client, scriptSource, [{ namespace: 'oz_multisig::multisig', code: multisigMasm }], midenRpcEndpoint);
}
export async function buildUpdateProcedureThresholdTransactionRequest(client, procedure, threshold, options = {}) {
    const signatureScheme = options.signatureScheme ?? 'falcon';
    const { configHash } = buildProcedureThresholdAdvice(procedure, threshold);
    const script = await buildUpdateProcedureThresholdScript(client, procedure, threshold, signatureScheme, options.midenRpcEndpoint);
    const authSaltHex = options.salt ? options.salt.toHex() : randomWord().toHex();
    const authSalt = WordType.fromHex(normalizeHexWord(authSaltHex));
    let txBuilder = new TransactionRequestBuilder();
    txBuilder = txBuilder.withCustomScript(script);
    txBuilder = txBuilder.withAuthArg(authSalt);
    if (options.signatureAdviceMap) {
        txBuilder = txBuilder.extendAdviceMap(options.signatureAdviceMap);
    }
    return {
        request: txBuilder.build(),
        salt: WordType.fromHex(normalizeHexWord(authSaltHex)),
        configHash,
    };
}
//# sourceMappingURL=updateProcedureThreshold.js.map