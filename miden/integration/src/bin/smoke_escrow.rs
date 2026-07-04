// Testnet smoke test for the buyer side of a session: creates a scratch buyer
// wallet, mints BART to it, consumes the mint note, then builds and submits
// the BartokSettlement escrow note. Prints everything settle_session needs.
//
// This is also the reference implementation for the browser wallet
// (ux-prototype/src/wallet.js) — same steps, same storage layout.
//
// Usage: smoke_escrow [--budget <units>]
use std::time::Duration;

use anyhow::{Context, Result};
use integration::helpers::{create_basic_wallet_account, setup_client, ClientSetup};
use miden_client::{
    account::{AccountId, AccountType},
    asset::{Asset, FungibleAsset},
    note::{
        Note, NoteAssets, NoteRecipient, NoteScript, NoteStorage, NoteTag, NoteType,
        PartialNoteMetadata,
    },
    transaction::TransactionRequestBuilder,
    utils::Deserializable,
    Felt, Word,
};
use miden_mast_package::Package;
use miden_standards::note::P2idNoteStorage;
use rand::RngCore;

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

fn word_csv(w: Word) -> String {
    (0..4)
        .map(|i| w[i].as_canonical_u64().to_string())
        .collect::<Vec<_>>()
        .join(",")
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let budget: u64 = args
        .iter()
        .position(|a| a == "--budget")
        .and_then(|i| args.get(i + 1))
        .map(|v| v.parse())
        .transpose()?
        .unwrap_or(25_000);

    let accounts: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string("../accounts.json")?)
            .context("run setup_accounts first")?;
    let seller = AccountId::from_hex(accounts["seller"].as_str().context("seller missing")?)?;
    let faucet = AccountId::from_hex(accounts["faucet"].as_str().context("faucet missing")?)?;
    let operator_tag: u32 = accounts["operatorTag"].as_u64().context("operatorTag missing")? as u32;

    let ClientSetup {
        mut client,
        keystore,
    } = setup_client().await?;
    client.sync_state().await.context("initial sync failed")?;

    // 1. Scratch buyer wallet.
    let buyer =
        create_basic_wallet_account(&mut client, keystore.clone(), AccountType::Private).await?;
    println!("buyer: {}", buyer.id().to_hex());

    // 2. Mint BART to the buyer (as the faucet — same keystore).
    let mint_request = TransactionRequestBuilder::new().build_mint_fungible_asset(
        FungibleAsset::new(faucet, budget * 2)?,
        buyer.id(),
        NoteType::Public,
        client.rng(),
    )?;
    let mint_tx = client.submit_new_transaction(faucet, mint_request).await?;
    println!("mint tx: https://testnet.midenscan.com/tx/{}", mint_tx.to_hex());

    // 3. Wait for the mint note and consume it as the buyer.
    let minted = 'outer: {
        for _ in 0..36 {
            client.sync_state().await?;
            let consumable = client.get_consumable_notes(Some(buyer.id())).await?;
            if let Some((record, _)) = consumable.first() {
                break 'outer record.clone();
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
        anyhow::bail!("mint note never became consumable");
    };
    let mint_note: Note = minted.try_into().context("mint note missing details")?;
    let consume_request = TransactionRequestBuilder::new().build_consume_notes(vec![mint_note])?;
    let consume_tx = client.submit_new_transaction(buyer.id(), consume_request).await?;
    println!("consume tx: https://testnet.midenscan.com/tx/{}", consume_tx.to_hex());

    // 4. Build the escrow note (same layout as wallet.js / the MockChain test).
    let masp_bytes =
        std::fs::read("../contracts/settlement-note/target/miden/release/bartok-settlement.masp")
            .or_else(|_| {
                std::fs::read(
                    "../contracts/settlement-note/target/miden/release/bartok_settlement.masp",
                )
            })
            .context("build the contract first (cargo miden build --release)")?;
    let package = Package::read_from_bytes(&masp_bytes)?;
    let script = NoteScript::from_package(&package)?;

    let seller_serial = random_word();
    let buyer_serial = random_word();
    let seller_rec = P2idNoteStorage::new(seller).into_recipient(seller_serial);
    let buyer_rec = P2idNoteStorage::new(buyer.id()).into_recipient(buyer_serial);
    let sr = seller_rec.digest();
    let br = buyer_rec.digest();

    let storage = NoteStorage::new(vec![
        sr[0], sr[1], sr[2], sr[3],
        Felt::from(NoteTag::with_account_target(seller)),
        br[0], br[1], br[2], br[3],
        Felt::from(NoteTag::with_account_target(buyer.id())),
        Felt::from(NoteType::Public),
    ])?;

    let escrow_note = Note::new(
        NoteAssets::new(vec![Asset::Fungible(FungibleAsset::new(faucet, budget)?)])?,
        PartialNoteMetadata::new(buyer.id(), NoteType::Public)
            .with_tag(NoteTag::from(operator_tag)),
        NoteRecipient::new(random_word(), script, storage),
    );

    let escrow_request = TransactionRequestBuilder::new()
        .own_output_notes(vec![escrow_note.clone()])
        .build()?;
    let escrow_tx = client.submit_new_transaction(buyer.id(), escrow_request).await?;

    println!("escrow tx: https://testnet.midenscan.com/tx/{}", escrow_tx.to_hex());
    println!("escrow note: https://testnet.midenscan.com/note/{}", escrow_note.id().to_hex());
    println!();
    println!("settle with:");
    println!(
        "cargo run --release -p integration --bin settle_session -- --note-id {} --charge <N> --buyer {} --seller-serial {} --buyer-serial {}",
        escrow_note.id().to_hex(),
        buyer.id().to_hex(),
        word_csv(seller_serial),
        word_csv(buyer_serial),
    );
    Ok(())
}
