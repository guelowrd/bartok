// Settles a session on Miden testnet through the OPERATOR's Guardian multisig:
// the settlement tx is pushed to Bartok-Guardian as a custom proposal
// ("bartok_settle"), countersigned (operator signer auto-attached + Guardian
// ACK), and only then submitted on-chain. The escrow note rides as an
// UNAUTHENTICATED input note (full details from --escrow-note-b64), so private
// escrow notes need no node lookup. Afterwards João's payment note is consumed
// through HIS Guardian multisig via a consume_notes v2 proposal.
//
// The last stdout line is a JSON object:
//   {"txId?","sellerNoteId","buyerNoteId","charge","refund","explorer",
//    "refundNoteFileB64","settleProposalId","joaoProposalId?"}
//
// Usage: settle_session --escrow-note-b64 <b64> --charge <u64> --buyer <hex-id>
//                       --seller-serial <a,b,c,d> --buyer-serial <a,b,c,d>
use anyhow::{bail, Context, Result};
use base64::Engine;
use integration::helpers::guardian_role_client;
use miden_client::{
    account::AccountId,
    asset::{Asset, FungibleAsset},
    note::{
        Note, NoteAssets, NoteDetails, NoteFile, NoteTag, NoteType, PartialNoteMetadata,
    },
    transaction::TransactionRequestBuilder,
    utils::{Deserializable, Serializable},
    Felt, Word,
};
use miden_standards::note::P2idNoteStorage;
use rand::RngCore;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

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

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let escrow_b64 = arg_value(&args, "--escrow-note-b64")?;
    let charge: u64 = arg_value(&args, "--charge")?.parse().context("bad charge")?;
    let buyer = AccountId::from_hex(&arg_value(&args, "--buyer")?).context("bad buyer id")?;
    let seller_serial = parse_serial(&arg_value(&args, "--seller-serial")?)?;
    let buyer_serial = parse_serial(&arg_value(&args, "--buyer-serial")?)?;

    let accounts: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string("../accounts.json")?)
            .context("run setup_accounts + setup_multisigs first")?;
    let seller = AccountId::from_hex(
        accounts["sellerMultisig"].as_str().context("sellerMultisig missing — run setup_multisigs")?,
    )?;
    let operator_multisig = AccountId::from_hex(
        accounts["operatorMultisig"].as_str().context("operatorMultisig missing")?,
    )?;
    let faucet = AccountId::from_hex(accounts["faucet"].as_str().context("faucet missing")?)?;
    let guardian_grpc = accounts["guardianGrpc"].as_str().context("guardianGrpc missing")?;

    // Full escrow note from the bridge (private notes never touch the node's public state).
    let escrow_note = Note::read_from_bytes(
        &B64.decode(escrow_b64.trim()).context("escrow b64 decode")?,
    )
    .map_err(|e| anyhow::anyhow!("escrow note deserialize: {e:?}"))?;

    // Budget = escrowed BART amount.
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

    // Output notes inherit the escrow note's visibility (the contract reads it
    // from storage; the escrow metadata is authoritative and needs no magic felt).
    let out_note_type = escrow_note.metadata().note_type();

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

    let args_word = Word::from([
        Felt::new(charge).map_err(|e| anyhow::anyhow!("bad charge felt: {e:?}"))?,
        Felt::ZERO,
        Felt::ZERO,
        Felt::ZERO,
    ]);
    let salt = random_word();

    // The request must be summary-reproducible between propose and execute:
    // identical note, args, recipients, and auth salt each time.
    let build_request = |advice: &[(Word, Vec<Felt>)]| -> Result<_> {
        let mut b = TransactionRequestBuilder::new()
            .input_notes([(escrow_note.clone(), Some(args_word))])
            .expected_output_recipients(expected.clone())
            .auth_arg(salt);
        for (k, v) in advice {
            b = b.extend_advice_map([(*k, v.clone())]);
        }
        b.build().context("build settlement request")
    };

    let mut operator =
        guardian_role_client("operator", guardian_grpc, Some(operator_multisig)).await?;

    let request_bytes = build_request(&[])?.to_bytes();
    let proposal = operator
        .propose_custom_transaction(&request_bytes, "bartok_settle")
        .await
        .map_err(|e| anyhow::anyhow!("propose bartok_settle: {e:?}"))?;
    eprintln!("settle proposal {} pushed to Bartok-Guardian", proposal.id);

    let advice = operator
        .prepare_custom_execution(&proposal.id, &request_bytes)
        .await
        .map_err(|e| anyhow::anyhow!("prepare_custom_execution: {e:?}"))?;

    let exec_request = build_request(&advice)?;
    operator
        .submit_transaction(exec_request)
        .await
        .map_err(|e| anyhow::anyhow!("submit settlement: {e:?}"))?;

    // Output note ids derive from recipient digest + assets.
    let make_note = |amount: u64, recipient: &miden_client::note::NoteRecipient, target: AccountId| -> Result<Note> {
        Ok(Note::new(
            NoteAssets::new(vec![Asset::Fungible(FungibleAsset::new(faucet, amount)?)])?,
            PartialNoteMetadata::new(operator_multisig, out_note_type)
                .with_tag(NoteTag::with_account_target(target)),
            recipient.clone(),
        ))
    };
    let seller_note = (charge > 0).then(|| make_note(charge, &seller_recipient, seller)).transpose()?;
    let buyer_note = (refund > 0).then(|| make_note(refund, &buyer_recipient, buyer)).transpose()?;

    let seller_note_file_b64 = seller_note.as_ref().map(|n| {
        let file = NoteFile::NoteDetails {
            details: NoteDetails::new(n.assets().clone(), n.recipient().clone()),
            after_block_num: 0.into(),
            tag: Some(NoteTag::with_account_target(seller)),
        };
        B64.encode(file.to_bytes())
    });

    // Refund note details for the buyer (bridge -> browser -> consume v2 proposal).
    let refund_note_file_b64 = buyer_note
        .as_ref()
        .map(|n| {
            let file = NoteFile::NoteDetails {
                details: NoteDetails::new(n.assets().clone(), n.recipient().clone()),
                after_block_num: 0.into(),
                tag: Some(NoteTag::with_account_target(buyer)),
            };
            B64.encode(file.to_bytes())
        });


    let out = serde_json::json!({
        "settleProposalId": proposal.id,
        "sellerNoteId": seller_note.as_ref().map(|n| n.id().to_hex()),
        "buyerNoteId": buyer_note.as_ref().map(|n| n.id().to_hex()),
        "charge": charge,
        "refund": refund,
        "refundNoteFileB64": refund_note_file_b64,
        "sellerNoteFileB64": seller_note_file_b64,
        "explorer": format!("https://testnet.midenscan.com/account/{}", operator_multisig.to_hex()),
    });
    println!("{}", serde_json::to_string(&out)?);
    Ok(())
}
