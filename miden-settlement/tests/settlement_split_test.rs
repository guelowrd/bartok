// BARTOK settlement note — increment 1 (TDD): the escrow note splits the budget
// into a payment to the seller and a refund to the buyer as two P2ID output notes.
// (On-chain oracle gating is deferred; see contract notes + repo ARCHITECTURE.md.)
use std::{path::Path, sync::Arc};

use anyhow::Context;
use integration::helpers::build_project_in_dir;
use miden_client::{
    asset::{Asset, FungibleAsset},
    auth::AuthSchemeId,
    note::{Note, NoteAssets, NoteMetadata, NoteRecipient, NoteScript, NoteStorage, NoteTag, NoteType},
    transaction::RawOutputNote,
    Felt, Word,
};
use miden_standards::note::{P2idNote, P2idNoteStorage};
use miden_testing::{Auth, MockChain};

#[tokio::test]
async fn settlement_split_test() -> anyhow::Result<()> {
    // Budget + charge are env-configurable so the end-to-end stitch can feed the oracle's
    // zkTLS-derived charge in (BARTOK_CHARGE = tokens used). Defaults make this a standalone test.
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
        Path::new("../contracts/bartok-settlement"),
        true,
    )?);
    let script = NoteScript::from_package(pkg.as_ref()).context("note script from package")?;

    let p2id_root = P2idNote::script_root();
    let seller_tag = NoteTag::with_account_target(seller.id());
    let buyer_tag = NoteTag::with_account_target(buyer.id());
    let seller_serial = Word::from([Felt::new(11), Felt::new(12), Felt::new(13), Felt::new(14)]);
    let buyer_serial = Word::from([Felt::new(21), Felt::new(22), Felt::new(23), Felt::new(24)]);

    let storage = NoteStorage::new(vec![
        p2id_root[0], p2id_root[1], p2id_root[2], p2id_root[3],
        faucet.id().suffix(), faucet.id().prefix().as_felt(),
        Felt::new(charge),
        seller.id().suffix(), seller.id().prefix().as_felt(),
        Felt::from(seller_tag),
        seller_serial[0], seller_serial[1], seller_serial[2], seller_serial[3],
        buyer.id().suffix(), buyer.id().prefix().as_felt(),
        Felt::from(buyer_tag),
        buyer_serial[0], buyer_serial[1], buyer_serial[2], buyer_serial[3],
        Felt::from(NoteType::Public),
    ])?;

    let escrow_serial = Word::from([Felt::new(1), Felt::new(2), Felt::new(3), Felt::new(4)]);
    let recipient = NoteRecipient::new(escrow_serial, script, storage);
    let metadata = NoteMetadata::new(consumer.id(), NoteType::Public)
        .with_tag(NoteTag::with_account_target(consumer.id()));
    let assets = NoteAssets::new(vec![Asset::Fungible(FungibleAsset::new(faucet.id(), budget)?)])?;
    let escrow_note = Note::new(assets, metadata, recipient);

    builder.add_output_note(RawOutputNote::Full(escrow_note.clone()));
    let mut mock_chain = builder.build()?;

    let tx = mock_chain
        .build_tx_context(consumer.clone(), &[escrow_note.id()], &[])?
        .build()?;
    let executed = tx.execute().await?;

    let seller_p2id = P2idNoteStorage::new(seller.id()).into_recipient(seller_serial);
    let buyer_p2id = P2idNoteStorage::new(buyer.id()).into_recipient(buyer_serial);

    let out = executed.output_notes();
    assert_eq!(out.num_notes(), 2, "expected two output notes");

    let mut found_seller = false;
    let mut found_buyer = false;
    for i in 0..out.num_notes() {
        let note = out.get_note(i);
        let rec = note.recipient_digest();
        let amount = match note.assets().iter().next().unwrap() {
            Asset::Fungible(fa) => fa.amount(),
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
    assert!(found_seller, "no P2ID output to the seller");
    assert!(found_buyer, "no P2ID output to the buyer");
    Ok(())
}
