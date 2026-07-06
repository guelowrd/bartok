// Creates a fresh BART faucet with the protocol-max supply (2^63 - 2^31,
// effectively unlimited) and merges its id into ../accounts.json — everything
// else (multisigs, tags, guardian endpoints) untouched. Existing wallets keep
// their old-faucet tokens, which simply stop counting; testers redeem again.
//
// Run from bartok/miden/integration:
//   cargo run --release -p integration --bin new_faucet
use anyhow::{Context, Result};
use integration::helpers::{create_basic_faucet_account, setup_client, ClientSetup};

const MAX_SUPPLY: u64 = (1u64 << 63) - (1u64 << 31); // AssetAmount::MAX

#[tokio::main]
async fn main() -> Result<()> {
    let ClientSetup { mut client, keystore } = setup_client().await?;
    client.sync_state().await.context("initial sync failed")?;

    let faucet =
        create_basic_faucet_account(&mut client, keystore, "BART", 0, MAX_SUPPLY).await?;
    println!("new BART faucet: {} (max supply {})", faucet.id().to_hex(), MAX_SUPPLY);
    println!("Explorer: https://testnet.midenscan.com/account/{}", faucet.id().to_hex());

    let mut accounts: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string("../accounts.json")?)?;
    accounts["faucet"] = serde_json::json!(faucet.id().to_hex());
    std::fs::write("../accounts.json", serde_json::to_string_pretty(&accounts)?)?;
    println!("accounts.json updated");
    Ok(())
}
