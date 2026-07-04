// BARTOK settlement note — the escrow note splits the budget into a payment to
// the seller and a refund to the buyer as two P2ID output notes. The charge is
// supplied at consumption time as the note ARG (it is only known at session end).
// (On-chain oracle gating is deferred; see contract notes + repo ARCHITECTURE.md.)
use std::{collections::BTreeMap, path::Path, sync::Arc};

use anyhow::Context;
use integration::helpers::build_project_in_dir;
use miden_client::{
    asset::{Asset, FungibleAsset},
    auth::AuthSchemeId,
    note::{
        Note, NoteAssets, NoteRecipient, NoteScript, NoteStorage, NoteTag, NoteType,
        PartialNoteMetadata,
    },
    transaction::RawOutputNote,
    Felt, Word,
};
use miden_standards::note::P2idNoteStorage;
use miden_testing::{Auth, MockChain};

#[tokio::test]
async fn settlement_split_test() -> anyhow::Result<()> {
    // Budget + charge are env-configurable so the end-to-end stitch can feed the oracle's
    // zkTLS-derived charge in (BARTOK_CHARGE = tokens × price). Defaults make this standalone.
    let budget: u64 = std::env::var("BARTOK_BUDGET").ok().and_then(|v| v.parse().ok()).unwrap_or(1000);
    let charge: u64 = std::env::var("BARTOK_CHARGE").ok().and_then(|v| v.parse().ok()).unwrap_or(300);
    assert!(charge <= budget, "charge must not exceed budget");
    let refund = budget - charge;
    let auth = || Auth::BasicAuth { auth_scheme: AuthSchemeId::Falcon512Poseidon2 };

    let mut builder = MockChain::builder();
    let faucet = builder.add_existing_basic_faucet(auth(), "TEST", 1_000_000, Some(1_000_000))?;
    let consumer = builder.add_existing_wallet(auth())?;
    let seller = builder.add_existing_wallet(auth())?;
    let buyer = builder.add_existing_wallet(auth())?;

    let pkg = Arc::new(build_project_in_dir(
        Path::new("../contracts/settlement-note"),
        true,
    )?);
    let script = NoteScript::from_package(pkg.as_ref()).context("note script from package")?;

    let seller_tag = NoteTag::with_account_target(seller.id());
    let buyer_tag = NoteTag::with_account_target(buyer.id());
    let seller_serial = Word::from([11_u32, 12, 13, 14]);
    let buyer_serial = Word::from([21_u32, 22, 23, 24]);

    // The P2ID recipients are precomputed host-side and passed in storage;
    // the note script hands them straight to output_note::create.
    let seller_p2id = P2idNoteStorage::new(seller.id()).into_recipient(seller_serial);
    let buyer_p2id = P2idNoteStorage::new(buyer.id()).into_recipient(buyer_serial);
    let seller_rec = seller_p2id.digest();
    let buyer_rec = buyer_p2id.digest();

    // 11-felt storage layout (charge is NOT in storage — it arrives as the note arg).
    // Order must match the field declaration order in contracts/settlement-note/src/lib.rs.
    let storage = NoteStorage::new(vec![
        seller_rec[0], seller_rec[1], seller_rec[2], seller_rec[3],
        Felt::from(seller_tag),
        buyer_rec[0], buyer_rec[1], buyer_rec[2], buyer_rec[3],
        Felt::from(buyer_tag),
        Felt::from(NoteType::Public),
    ])?;

    let escrow_serial = Word::from([1_u32, 2, 3, 4]);
    let recipient = NoteRecipient::new(escrow_serial, script, storage);
    let metadata = PartialNoteMetadata::new(consumer.id(), NoteType::Public)
        .with_tag(NoteTag::with_account_target(consumer.id()));
    let assets = NoteAssets::new(vec![Asset::Fungible(FungibleAsset::new(faucet.id(), budget)?)])?;
    let escrow_note = Note::new(assets, metadata, recipient);

    builder.add_output_note(RawOutputNote::Full(escrow_note.clone()));
    let mut mock_chain = builder.build()?;

    // Public script-created notes need their recipient details in the advice
    // provider; register the expected P2ID outputs (only recipients are used).
    let expected_outputs: Vec<RawOutputNote> = [
        (charge, &seller_p2id, seller_tag),
        (refund, &buyer_p2id, buyer_tag),
    ]
    .into_iter()
    .filter(|(amount, _, _)| *amount > 0)
    .map(|(amount, recipient, tag)| {
        anyhow::Ok(RawOutputNote::Full(Note::new(
            NoteAssets::new(vec![Asset::Fungible(FungibleAsset::new(faucet.id(), amount)?)])?,
            PartialNoteMetadata::new(consumer.id(), NoteType::Public).with_tag(tag),
            (*recipient).clone(),
        )))
    })
    .collect::<Result<_, _>>()?;

    let tx = mock_chain
        .build_tx_context(consumer.clone(), &[escrow_note.id()], &[])?
        .extend_note_args(BTreeMap::from([(
            escrow_note.id(),
            Word::from([Felt::new(charge)?, Felt::ZERO, Felt::ZERO, Felt::ZERO]),
        )]))
        .extend_expected_output_notes(expected_outputs)
        .build()?;
    let executed = tx.execute().await?;

    // Zero-amount output notes are skipped by the script.
    let expected_notes = (charge > 0) as usize + (refund > 0) as usize;
    let out = executed.output_notes();
    assert_eq!(out.num_notes(), expected_notes, "unexpected number of output notes");

    let mut found_seller = false;
    let mut found_buyer = false;
    for i in 0..out.num_notes() {
        let note = out.get_note(i);
        let rec = note.recipient_digest();
        let amount = match note.assets().iter().next().unwrap() {
            Asset::Fungible(fa) => fa.amount().as_u64(),
            _ => panic!("expected fungible asset"),
        };
        if rec == seller_p2id.digest() {
            assert_eq!(amount, charge, "seller should receive the charge");
            found_seller = true;
        } else if rec == buyer_p2id.digest() {
            assert_eq!(amount, refund, "buyer should receive the refund");
            found_buyer = true;
        }
    }
    assert_eq!(found_seller, charge > 0, "seller P2ID presence mismatch");
    assert_eq!(found_buyer, refund > 0, "buyer P2ID presence mismatch");
    Ok(())
}
