// Consumes the session escrow note as the operator, passing the charge as the
// note ARG. The BartokSettlement script splits the escrow into P2ID(charge) to
// João and P2ID(refund) back to the buyer. Afterwards it best-effort consumes
// João's payment note so the seller balance is real.
//
// The last stdout line is a JSON object:
//   {"txId","sellerNoteId","buyerNoteId","charge","refund","explorer"}
//
// Usage: settle_session --note-id <hex> --charge <u64> --buyer <hex-id>
//                       --seller-serial <a,b,c,d> --buyer-serial <a,b,c,d>
use std::time::Duration;

use anyhow::{bail, Context, Result};
use integration::helpers::{setup_client, ClientSetup};
use miden_client::{
    account::AccountId,
    asset::{Asset, FungibleAsset},
    note::{Note, NoteAssets, NoteFile, NoteId, NoteTag, NoteType, PartialNoteMetadata},
    transaction::TransactionRequestBuilder,
    Client, Felt, Word,
};
use miden_client::keystore::FilesystemKeyStore;
use miden_standards::note::P2idNoteStorage;

fn arg_value(args: &[String], flag: &str) -> Result<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .with_context(|| format!("missing {flag} <value>"))
}

fn parse_serial(s: &str) -> Result<Word> {
    let felts: Vec<Felt> = s
        .split(',')
        .map(|p| {
            p.trim()
                .parse::<u64>()
                .context("serial parts must be u64")
                .and_then(|v| Felt::new(v).map_err(|e| anyhow::anyhow!("bad felt: {e:?}")))
        })
        .collect::<Result<_>>()?;
    if felts.len() != 4 {
        bail!("serial must have 4 comma-separated parts");
    }
    Ok(Word::new([felts[0], felts[1], felts[2], felts[3]]))
}

async fn wait_for_committed_note(
    client: &mut Client<FilesystemKeyStore>,
    note_id: NoteId,
) -> Result<Note> {
    for _ in 0..36 {
        client.sync_state().await.context("sync failed")?;
        if let Some(record) = client.get_input_note(note_id).await? {
            if record.is_committed() {
                let note: Note = record.try_into().context("note record missing details")?;
                return Ok(note);
            }
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    bail!("timed out waiting for note {} to commit", note_id.to_hex());
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let note_id_hex = arg_value(&args, "--note-id")?;
    let charge: u64 = arg_value(&args, "--charge")?.parse().context("bad charge")?;
    let buyer = AccountId::from_hex(&arg_value(&args, "--buyer")?).context("bad buyer id")?;
    let seller_serial = parse_serial(&arg_value(&args, "--seller-serial")?)?;
    let buyer_serial = parse_serial(&arg_value(&args, "--buyer-serial")?)?;

    let accounts: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string("../accounts.json")?)
            .context("run setup_accounts first")?;
    let seller = AccountId::from_hex(accounts["seller"].as_str().context("seller missing")?)?;
    let operator = AccountId::from_hex(accounts["operator"].as_str().context("operator missing")?)?;
    let faucet = AccountId::from_hex(accounts["faucet"].as_str().context("faucet missing")?)?;

    let ClientSetup { mut client, .. } = setup_client().await?;
    client.sync_state().await.context("initial sync failed")?;

    // Fetch the public escrow note from the node and wait until it is committed.
    let note_id = NoteId::try_from_hex(&note_id_hex).context("bad note id hex")?;
    client
        .import_notes(&[NoteFile::NoteId(note_id)])
        .await
        .context("failed to import escrow note from node")?;
    let escrow_note = wait_for_committed_note(&mut client, note_id).await?;

    // Budget = the escrowed BART amount.
    let budget = escrow_note
        .assets()
        .iter()
        .find_map(|a| match a {
            Asset::Fungible(fa) if fa.faucet_id() == faucet => Some(fa.amount().as_u64()),
            _ => None,
        })
        .context("escrow note carries no BART asset")?;
    if charge > budget {
        bail!("charge {charge} exceeds escrowed budget {budget}");
    }
    let refund = budget - charge;

    // Reconstruct the P2ID recipients the escrow storage committed to.
    let seller_recipient = P2idNoteStorage::new(seller).into_recipient(seller_serial);
    let buyer_recipient = P2idNoteStorage::new(buyer).into_recipient(buyer_serial);

    let mut expected = Vec::new();
    if charge > 0 {
        expected.push(seller_recipient.clone());
    }
    if refund > 0 {
        expected.push(buyer_recipient.clone());
    }

    let request = TransactionRequestBuilder::new()
        .input_notes([(
            escrow_note,
            Some(Word::from([
                Felt::new(charge).map_err(|e| anyhow::anyhow!("bad charge felt: {e:?}"))?,
                Felt::ZERO,
                Felt::ZERO,
                Felt::ZERO,
            ])),
        )])
        .expected_output_recipients(expected)
        .build()
        .context("failed to build settlement request")?;

    let tx_id = client
        .submit_new_transaction(operator, request)
        .await
        .context("settlement transaction failed")?;

    // Output note ids are derived from recipient digest + assets only.
    let note_ids = |amount: u64, recipient: &miden_client::note::NoteRecipient, target: AccountId| -> Result<NoteId> {
        let assets =
            NoteAssets::new(vec![Asset::Fungible(FungibleAsset::new(faucet, amount)?)])?;
        let metadata = PartialNoteMetadata::new(operator, NoteType::Public)
            .with_tag(NoteTag::with_account_target(target));
        Ok(Note::new(assets, metadata, recipient.clone()).id())
    };
    let seller_note_id = (charge > 0)
        .then(|| note_ids(charge, &seller_recipient, seller))
        .transpose()?;
    let buyer_note_id = (refund > 0)
        .then(|| note_ids(refund, &buyer_recipient, buyer))
        .transpose()?;

    // Best-effort: consume João's payment note so his balance is real.
    if let Some(seller_note) = seller_note_id {
        if let Err(e) = consume_as_seller(&mut client, seller, seller_note).await {
            eprintln!("warning: seller auto-consume failed: {e:#}");
        }
    }

    let out = serde_json::json!({
        "txId": tx_id.to_hex(),
        "sellerNoteId": seller_note_id.map(|n| n.to_hex()),
        "buyerNoteId": buyer_note_id.map(|n| n.to_hex()),
        "charge": charge,
        "refund": refund,
        "explorer": format!("https://testnet.midenscan.com/tx/{}", tx_id.to_hex()),
    });
    println!("{}", serde_json::to_string(&out)?);
    Ok(())
}

async fn consume_as_seller(
    client: &mut Client<FilesystemKeyStore>,
    seller: AccountId,
    note_id: NoteId,
) -> Result<()> {
    for _ in 0..24 {
        client.sync_state().await?;
        let consumable = client.get_consumable_notes(Some(seller)).await?;
        if let Some((record, _)) = consumable.iter().find(|(r, _)| r.id() == Some(note_id)) {
            let note: Note = record.clone().try_into().context("missing note details")?;
            let request = TransactionRequestBuilder::new().build_consume_notes(vec![note])?;
            let tx = client.submit_new_transaction(seller, request).await?;
            eprintln!("seller consumed payment note in tx {}", tx.to_hex());
            return Ok(());
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    bail!("payment note never became consumable")
}
