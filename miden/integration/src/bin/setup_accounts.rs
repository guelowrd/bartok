// One-time testnet setup: creates João's (seller) wallet, the operator wallet,
// and the public BART faucet, then writes ../accounts.json for the UI bridge.
//
// Run from bartok/miden/integration:
//   cargo run --release -p integration --bin setup_accounts
use anyhow::{Context, Result};
use integration::helpers::{
    create_basic_faucet_account, create_basic_wallet_account, setup_client, ClientSetup,
};
use miden_client::{account::AccountType, note::NoteTag};

#[tokio::main]
async fn main() -> Result<()> {
    let ClientSetup {
        mut client,
        keystore,
    } = setup_client().await?;

    let sync = client.sync_state().await.context("initial sync failed")?;
    println!("Latest block: {}", sync.block_num);

    let seller =
        create_basic_wallet_account(&mut client, keystore.clone(), AccountType::Private).await?;
    println!("Seller (João) account: {}", seller.id().to_hex());

    let operator =
        create_basic_wallet_account(&mut client, keystore.clone(), AccountType::Private).await?;
    println!("Operator account: {}", operator.id().to_hex());

    let faucet =
        create_basic_faucet_account(&mut client, keystore.clone(), "BART", 0, 100_000_000).await?;
    println!("BART faucet account: {}", faucet.id().to_hex());
    println!("Explorer: https://testnet.midenscan.com/account/{}", faucet.id().to_hex());

    let operator_tag = NoteTag::with_account_target(operator.id());

    let accounts = serde_json::json!({
        "seller": seller.id().to_hex(),
        "operator": operator.id().to_hex(),
        "faucet": faucet.id().to_hex(),
        "operatorTag": u32::from(operator_tag),
        "explorer": "https://testnet.midenscan.com",
    });
    std::fs::write("../accounts.json", serde_json::to_string_pretty(&accounts)?)
        .context("failed to write ../accounts.json")?;
    println!("Wrote ../accounts.json");
    Ok(())
}
