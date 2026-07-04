// Per-session escrow parameters: generates the two P2ID serials and computes
// the precomputed P2ID recipients the BartokSettlement note storage carries.
// The last stdout line is a JSON object; felts are decimal strings (u64-safe
// for the browser via BigInt).
//
// Usage: escrow_params --seller <hex-id> --buyer <hex-id>
use anyhow::{bail, Context, Result};
use miden_client::{
    account::AccountId,
    note::{NoteTag, NoteType},
    Felt, Word,
};
use miden_standards::note::P2idNoteStorage;
use rand::RngCore;

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
            // rejection-sample into the field
            if let Ok(f) = Felt::new(rng.next_u64()) {
                break f;
            }
        })
        .collect();
    Word::new([felts[0], felts[1], felts[2], felts[3]])
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let seller = AccountId::from_hex(&arg_value(&args, "--seller")?).context("bad seller id")?;
    let buyer = AccountId::from_hex(&arg_value(&args, "--buyer")?).context("bad buyer id")?;
    if seller == buyer {
        bail!("seller and buyer must differ");
    }

    let seller_serial = random_word();
    let buyer_serial = random_word();

    let seller_recipient = P2idNoteStorage::new(seller).into_recipient(seller_serial);
    let buyer_recipient = P2idNoteStorage::new(buyer).into_recipient(buyer_serial);

    let out = serde_json::json!({
        "sellerRecipient": word_strings(seller_recipient.digest()),
        "sellerTag": u32::from(NoteTag::with_account_target(seller)),
        "sellerSerial": word_strings(seller_serial),
        "buyerRecipient": word_strings(buyer_recipient.digest()),
        "buyerTag": u32::from(NoteTag::with_account_target(buyer)),
        "buyerSerial": word_strings(buyer_serial),
        "noteType": Felt::from(NoteType::Public).as_canonical_u64().to_string(),
    });
    println!("{}", serde_json::to_string(&out)?);
    Ok(())
}
