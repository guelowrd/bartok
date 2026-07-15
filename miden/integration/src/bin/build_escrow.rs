// Builds a full session escrow: the P2ID recipients/serials AND the escrow
// TransactionRequest bytes (own-output BartokSettlement note, private).
//
// Rust builds the request so the browser never constructs SDK Felt/Note objects
// (which would fork a second @miden-sdk WASM instance next to the Guardian
// multisig client's, and wasm-bindgen rejects cross-instance values). The
// browser just drives the Guardian custom proposal over these bytes.
//
// Last stdout line is JSON: { sellerRecipient, sellerTag, sellerSerial,
//   buyerRecipient, buyerTag, buyerSerial, noteType, requestB64, noteB64 }.
//
// Usage: build_escrow --seller <hex> --buyer <hex> --budget <units>
use anyhow::{bail, Context, Result};
use base64::Engine;
use miden_client::{
    account::AccountId,
    asset::{Asset, FungibleAsset},
    note::{
        Note, NoteAssets, NoteRecipient, NoteScript, NoteStorage, NoteTag, NoteType,
        PartialNoteMetadata,
    },
    transaction::TransactionRequestBuilder,
    utils::{Deserializable, Serializable},
    Felt, Word,
};
use miden_mast_package::Package;
use miden_standards::note::P2idNoteStorage;
use rand::RngCore;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;
const MASP: &str = "../contracts/settlement-note/target/miden/release/bartok-settlement.masp";
const MASP_ALT: &str = "../contracts/settlement-note/target/miden/release/bartok_settlement.masp";

fn arg_value(args: &[String], flag: &str) -> Result<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .with_context(|| format!("missing {flag} <value>"))
}

fn word_strings(w: Word) -> Vec<String> {
    (0..4).map(|i| w[i].as_canonical_u64().to_string()).collect()
}

fn random_word() -> Word {
    let mut rng = rand::rng();
    let felts: Vec<Felt> = (0..4)
        .map(|_| loop {
            if let Ok(f) = Felt::new(rng.next_u64()) {
                break f;
            }
        })
        .collect();
    Word::new([felts[0], felts[1], felts[2], felts[3]])
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let buyer = AccountId::from_hex(&arg_value(&args, "--buyer")?).context("bad buyer id")?;
    let budget: u64 = arg_value(&args, "--budget")?.parse().context("bad budget")?;

    let accounts: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string("../accounts.json")?)?;
    let seller = AccountId::from_hex(
        accounts["sellerMultisig"].as_str().context("sellerMultisig missing")?,
    )?;
    let faucet = AccountId::from_hex(accounts["faucet"].as_str().context("faucet missing")?)?;
    let operator = AccountId::from_hex(
        accounts["operatorMultisig"].as_str().context("operatorMultisig missing — run setup_multisigs")?,
    )?;
    let operator_tag = accounts["operatorTag"].as_u64().context("operatorTag missing")? as u32;
    if seller == buyer {
        bail!("seller and buyer must differ");
    }

    let seller_serial = random_word();
    let buyer_serial = random_word();
    let seller_recipient = P2idNoteStorage::new(seller).into_recipient(seller_serial);
    let buyer_recipient = P2idNoteStorage::new(buyer).into_recipient(buyer_serial);
    let sr = seller_recipient.digest();
    let br = buyer_recipient.digest();

    // 13-felt BartokSettlement storage (precomputed recipients + tags + note
    // type + operator gate: only the operator multisig may consume).
    let storage = NoteStorage::new(vec![
        sr[0], sr[1], sr[2], sr[3],
        Felt::from(NoteTag::with_account_target(seller)),
        br[0], br[1], br[2], br[3],
        Felt::from(NoteTag::with_account_target(buyer)),
        Felt::from(NoteType::Private),
        operator.prefix().as_felt(),
        operator.suffix(),
    ])?;

    let masp_bytes = std::fs::read(MASP)
        .or_else(|_| std::fs::read(MASP_ALT))
        .context("build the contract first (cargo miden build --release)")?;
    let package = Package::read_from_bytes(&masp_bytes)?;
    let script = NoteScript::from_package(&package)?;

    let escrow_note = Note::new(
        NoteAssets::new(vec![Asset::Fungible(FungibleAsset::new(faucet, budget)?)])?,
        PartialNoteMetadata::new(buyer, NoteType::Private).with_tag(NoteTag::from(operator_tag)),
        NoteRecipient::new(random_word(), script, storage),
    );

    // The escrow tx: buyer's account creates the escrow as an own-output note.
    // auth_arg is the multisig auth salt (random; the proposal binds it).
    let salt = random_word();
    let request = TransactionRequestBuilder::new()
        .own_output_notes(vec![escrow_note.clone()])
        .auth_arg(salt)
        .build()
        .context("build escrow request")?;

    let out = serde_json::json!({
        "sellerRecipient": word_strings(sr),
        "sellerTag": u32::from(NoteTag::with_account_target(seller)),
        "sellerSerial": word_strings(seller_serial),
        "buyerRecipient": word_strings(br),
        "buyerTag": u32::from(NoteTag::with_account_target(buyer)),
        "buyerSerial": word_strings(buyer_serial),
        "noteType": Felt::from(NoteType::Private).as_canonical_u64().to_string(),
        "requestB64": B64.encode(request.to_bytes()),
        "noteB64": B64.encode(escrow_note.to_bytes()),
    });
    println!("{}", serde_json::to_string(&out)?);
    Ok(())
}
