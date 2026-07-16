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
        Note, NoteAssets, NoteRecipient, NoteScript, NoteTag, NoteType,
        PartialNoteMetadata,
    },
    transaction::RawOutputNote,
    Felt, Word,
};
use miden_standards::note::P2idNoteStorage;
use miden_testing::{Auth, MockChain};

// Both tests consume the same compiled contract; building it once avoids two
// concurrent `cargo miden build`s racing on the artifact (one test reads a
// half-written .masp).
fn settlement_package() -> Arc<miden_mast_package::Package> {
    use std::sync::OnceLock;
    static PKG: OnceLock<Arc<miden_mast_package::Package>> = OnceLock::new();
    // get_or_init blocks concurrent callers, so the build runs exactly once.
    PKG.get_or_init(|| {
        Arc::new(
            build_project_in_dir(Path::new("../contracts/settlement-note"), true)
                .expect("build settlement contract"),
        )
    })
    .clone()
}

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

    let pkg = settlement_package();
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

    // Charge is NOT in storage — it arrives as the note arg. The consumer plays
    // the operator role: the gate target is the executing account.
    let storage = integration::helpers::settlement_storage(
        seller_rec, seller_tag, buyer_rec, buyer_tag, NoteType::Public, consumer.id())?;

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

// The escrow must be consumable ONLY by the operator. Without the gate, the
// buyer's wallet (which holds the note details it created) can consume the
// escrow with charge = 0 and refund itself the full budget, stiffing the
// seller — exactly the live bug this test pins down. The would-be theft is
// given everything it needs to succeed (charge arg + expected refund output),
// so the only thing standing in its way is the gate itself.
#[tokio::test]
async fn settlement_gate_rejects_non_operator() -> anyhow::Result<()> {
    let budget: u64 = 1000;
    let auth = || Auth::BasicAuth { auth_scheme: AuthSchemeId::Falcon512Poseidon2 };

    let mut builder = MockChain::builder();
    let faucet = builder.add_existing_basic_faucet(auth(), "TEST", 1_000_000, Some(1_000_000))?;
    let consumer = builder.add_existing_wallet(auth())?;
    let seller = builder.add_existing_wallet(auth())?;
    let buyer = builder.add_existing_wallet(auth())?;

    let pkg = settlement_package();
    let script = NoteScript::from_package(pkg.as_ref()).context("note script from package")?;

    let seller_tag = NoteTag::with_account_target(seller.id());
    let buyer_tag = NoteTag::with_account_target(buyer.id());
    let seller_p2id = P2idNoteStorage::new(seller.id()).into_recipient(Word::from([11_u32, 12, 13, 14]));
    let buyer_p2id = P2idNoteStorage::new(buyer.id()).into_recipient(Word::from([21_u32, 22, 23, 24]));
    let seller_rec = seller_p2id.digest();
    let buyer_rec = buyer_p2id.digest();

    // Gate target = consumer (operator role) — but the executor below is the buyer.
    let storage = integration::helpers::settlement_storage(
        seller_rec, seller_tag, buyer_rec, buyer_tag, NoteType::Public, consumer.id())?;

    let recipient = NoteRecipient::new(Word::from([1_u32, 2, 3, 4]), script, storage);
    let metadata = PartialNoteMetadata::new(consumer.id(), NoteType::Public)
        .with_tag(NoteTag::with_account_target(consumer.id()));
    let assets = NoteAssets::new(vec![Asset::Fungible(FungibleAsset::new(faucet.id(), budget)?)])?;
    let escrow_note = Note::new(assets, metadata, recipient);

    builder.add_output_note(RawOutputNote::Full(escrow_note.clone()));
    let mut mock_chain = builder.build()?;

    // charge = 0 → the script would emit one output note: the full-budget
    // "refund" back to the buyer. Register it so the consume can only fail
    // because of the gate, never for missing advice details.
    let refund_note = Note::new(
        NoteAssets::new(vec![Asset::Fungible(FungibleAsset::new(faucet.id(), budget)?)])?,
        PartialNoteMetadata::new(buyer.id(), NoteType::Public).with_tag(buyer_tag),
        buyer_p2id.clone(),
    );

    let tx = mock_chain
        .build_tx_context(buyer.clone(), &[escrow_note.id()], &[])?
        .extend_note_args(BTreeMap::from([(
            escrow_note.id(),
            Word::from([Felt::new(0)?, Felt::ZERO, Felt::ZERO, Felt::ZERO]),
        )]))
        .extend_expected_output_notes(vec![RawOutputNote::Full(refund_note)])
        .build()?;
    assert!(
        tx.execute().await.is_err(),
        "a non-operator account must not be able to consume the escrow note"
    );
    Ok(())
}
