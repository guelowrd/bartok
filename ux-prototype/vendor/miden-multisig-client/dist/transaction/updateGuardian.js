import { AdviceMap, FeltArray, TransactionRequestBuilder, Word as WordType, } from '@miden-sdk/miden-sdk';
import { GUARDIAN_ECDSA_MASM, GUARDIAN_MASM } from '../account/masm/auth.js';
import { compileTxScript } from '../raw-client.js';
import { normalizeHexWord } from '../utils/encoding.js';
import { randomWord } from '../utils/random.js';
async function buildUpdateGuardianScript(client, signatureScheme, midenRpcEndpoint) {
    const guardianLibraryPath = 'oz_guardian::guardian';
    const guardianMasm = signatureScheme === 'ecdsa' ? GUARDIAN_ECDSA_MASM : GUARDIAN_MASM;
    const scriptSource = `
use oz_guardian::guardian

begin
    adv.push_mapval
    dropw
    call.guardian::update_guardian_public_key
end
  `;
    return compileTxScript(client, scriptSource, [{ namespace: guardianLibraryPath, code: guardianMasm }], midenRpcEndpoint);
}
export async function buildUpdateGuardianTransactionRequest(client, newGuardianPubkey, options = {}) {
    const signatureScheme = options.signatureScheme ?? 'falcon';
    const script = await buildUpdateGuardianScript(client, signatureScheme, options.midenRpcEndpoint);
    const authSaltHex = options.salt ? options.salt.toHex() : randomWord().toHex();
    const pubkeyWordForAdvice = WordType.fromHex(normalizeHexWord(newGuardianPubkey));
    const pubkeyWordForFelts = WordType.fromHex(normalizeHexWord(newGuardianPubkey));
    const pubkeyWordForScript = WordType.fromHex(normalizeHexWord(newGuardianPubkey));
    const advice = new AdviceMap();
    advice.insert(pubkeyWordForAdvice, new FeltArray(pubkeyWordForFelts.toFelts()));
    const authSaltForBuilder = WordType.fromHex(normalizeHexWord(authSaltHex));
    let txBuilder = new TransactionRequestBuilder();
    txBuilder = txBuilder.withCustomScript(script);
    txBuilder = txBuilder.withScriptArg(pubkeyWordForScript);
    txBuilder = txBuilder.extendAdviceMap(advice);
    txBuilder = txBuilder.withAuthArg(authSaltForBuilder);
    if (options.signatureAdviceMap) {
        txBuilder = txBuilder.extendAdviceMap(options.signatureAdviceMap);
    }
    const authSaltForReturn = WordType.fromHex(normalizeHexWord(authSaltHex));
    return {
        request: txBuilder.build(),
        salt: authSaltForReturn,
    };
}
//# sourceMappingURL=updateGuardian.js.map