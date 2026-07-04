// Béla ops tool: drains João's pending Guardian proposals (e.g. consume
// proposals whose execution raced block inclusion) by executing them now.
use anyhow::{Context, Result};
use base64::Engine;
use integration::helpers::guardian_role_client;
use miden_client::account::AccountId;
use miden_client::note::Note;
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
        let note = Note::new(
            details.assets().clone(),
            miden_client::note::PartialNoteMetadata::new(operator, miden_client::note::NoteType::Private)
                .with_tag(tag.context("tag missing")?),
            details.recipient().clone(),
        );
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
