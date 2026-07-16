// Confirms the settlement escrow note is actually funded + committed on-chain
// BEFORE the bridge serves paid inference. The bridge passes its OWN
// build_escrow note bytes (never the client's copy), so a buyer cannot get free
// service by claiming an escrow that was never funded, nor redirect the payout
// with crafted note storage.
//
// Usage: verify_escrow --escrow-note-b64 <b64> [--tries <n>]
// Prints one JSON line: {"committed":true,"budget":<u64>} once the note commits,
// or {"committed":false,"budget":<u64>} if it never commits within the poll
// window. Exit code is 0 either way — the bridge reads the `committed` flag.
use anyhow::{Context, Result};
use base64::Engine;
use integration::helpers::{setup_client, ClientSetup};
use miden_client::{
    account::AccountId,
    asset::Asset,
    note::{Note, NoteDetails, NoteFile},
    utils::Deserializable,
};

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

fn arg(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned()
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let b64 = arg(&args, "--escrow-note-b64").context("missing --escrow-note-b64 <value>")?;
    let tries: u32 = arg(&args, "--tries").and_then(|v| v.parse().ok()).unwrap_or(40);

    let accounts: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string("../accounts.json")?)?;
    let faucet = AccountId::from_hex(accounts["faucet"].as_str().context("faucet missing")?)?;

    let note = Note::read_from_bytes(&B64.decode(b64.trim()).context("escrow b64 decode")?)
        .map_err(|e| anyhow::anyhow!("escrow note deserialize: {e:?}"))?;

    // Budget = the BART asset the note carries.
    let budget = note
        .assets()
        .iter()
        .find_map(|a| match a {
            Asset::Fungible(fa) if fa.faucet_id() == faucet => Some(fa.amount().as_u64()),
            _ => None,
        })
        .context("escrow note carries no BART asset")?;

    // Import by details (+ tag) and poll until the node reports it committed.
    // Private notes: the commitment is public even though the details are not,
    // so this proves the escrow was really funded on-chain.
    let ClientSetup { mut client, .. } = setup_client().await?;
    let file = NoteFile::NoteDetails {
        details: NoteDetails::new(note.assets().clone(), note.recipient().clone()),
        after_block_num: 0.into(),
        tag: Some(note.metadata().tag()),
    };
    client.import_notes(&[file]).await.map_err(|e| anyhow::anyhow!("import: {e:?}"))?;

    for _ in 0..tries {
        client.sync_state().await.ok();
        if let Ok(Some(r)) = client.get_input_note(note.id()).await {
            if r.is_committed() {
                println!("{}", serde_json::json!({ "committed": true, "budget": budget }));
                return Ok(());
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    }
    println!("{}", serde_json::json!({ "committed": false, "budget": budget }));
    Ok(())
}
