// Béla ops tool: drains João's pending Guardian proposals (e.g. consume
// proposals whose execution raced block inclusion) by executing them now.
use anyhow::{bail, Context, Result};
use base64::Engine;
use integration::helpers::{guardian_role_client, setup_client, ClientSetup};
use miden_client::account::AccountId;
use miden_client::note::{Note, NoteDetails, NoteFile, NoteTag, NoteType, PartialNoteMetadata};
use miden_client::utils::Deserializable;
use miden_multisig_client::{SerializedNote, TransactionType};

#[tokio::main]
async fn main() -> Result<()> {
    let accounts: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string("../accounts.json")?)?;
    let seller = AccountId::from_hex(accounts["sellerMultisig"].as_str().context("sellerMultisig")?)?;
    let operator = AccountId::from_hex(accounts["operatorMultisig"].as_str().context("operatorMultisig")?)?;
    let grpc = accounts["guardianGrpc"].as_str().context("guardianGrpc")?;

    let mut joao = guardian_role_client("joao", grpc, Some(seller)).await?;
    joao.sync().await.ok();

    // Optional manual drain: --note-file-b64 <NoteFile b64> proposes + executes
    // a consume for a payment note handed over out-of-band.
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--note-file-b64") {
        let b64 = args.get(i + 1).context("--note-file-b64 <value>")?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim())?;
        let file = miden_client::note::NoteFile::read_from_bytes(&bytes)
            .map_err(|e| anyhow::anyhow!("note file: {e:?}"))?;
        let miden_client::note::NoteFile::NoteDetails { details, tag, .. } = file else {
            anyhow::bail!("expected NoteDetails note file");
        };
        let tag = tag.context("tag missing")?;
        let note = Note::new(
            details.assets().clone(),
            PartialNoteMetadata::new(operator, NoteType::Private).with_tag(tag),
            details.recipient().clone(),
        );
        wait_note_committed(&details, note.id(), tag).await?;
        let p = joao
            .propose_transaction(TransactionType::ConsumeNotes {
                note_ids: vec![note.id()],
                metadata_version: Some(2),
                notes: vec![SerializedNote::from_note(&note)],
            })
            .await
            .map_err(|e| anyhow::anyhow!("propose: {e:?}"))?;
        joao.execute_proposal(&p.id)
            .await
            .map_err(|e| anyhow::anyhow!("execute: {e:?}"))?;
        println!("manual consume executed ✓ ({})", p.id);
        return Ok(());
    }

    let proposals = joao
        .list_proposals()
        .await
        .map_err(|e| anyhow::anyhow!("list: {e:?}"))?;
    if proposals.is_empty() {
        println!("no pending proposals");
        return Ok(());
    }
    for p in proposals {
        println!("executing pending proposal {} ({:?})", p.id, p.status);
        match joao.execute_proposal(&p.id).await {
            Ok(()) => println!("  executed ✓"),
            Err(e) => println!("  failed: {e:?}"),
        }
    }
    Ok(())
}


/// Waits until a private note is committed on-chain (imported by details + tag).
async fn wait_note_committed(details: &NoteDetails, note_id: miden_client::note::NoteId, tag: NoteTag) -> Result<()> {
    let ClientSetup { mut client, .. } = setup_client().await?;
    let file = NoteFile::NoteDetails { details: details.clone(), after_block_num: 0.into(), tag: Some(tag) };
    client.import_notes(&[file]).await.map_err(|e| anyhow::anyhow!("import: {e:?}"))?;
    for _ in 0..60 {
        client.sync_state().await.ok();
        if let Ok(Some(r)) = client.get_input_note(note_id).await {
            if r.is_committed() { return Ok(()); }
        }
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
    bail!("note never committed on-chain")
}