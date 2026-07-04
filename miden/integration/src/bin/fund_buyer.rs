// Mints BART from the faucet to a buyer wallet as a public P2ID note.
// The last stdout line is a JSON object: {"txId": "...", "explorer": "..."}.
//
// Usage: fund_buyer --buyer <hex-id> --amount <units>
use anyhow::{Context, Result};
use integration::helpers::{setup_client, ClientSetup};
use miden_client::{
    account::AccountId,
    asset::FungibleAsset,
    note::NoteType,
    transaction::TransactionRequestBuilder,
};

fn arg_value(args: &[String], flag: &str) -> Result<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .with_context(|| format!("missing {flag} <value>"))
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let buyer = AccountId::from_hex(&arg_value(&args, "--buyer")?).context("bad buyer id")?;
    let amount: u64 = arg_value(&args, "--amount")?.parse().context("bad amount")?;

    let accounts: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string("../accounts.json")?)
            .context("run setup_accounts first")?;
    let faucet = AccountId::from_hex(accounts["faucet"].as_str().context("faucet id missing")?)?;

    let ClientSetup { mut client, .. } = setup_client().await?;
    client.sync_state().await.context("sync failed")?;

    let asset = FungibleAsset::new(faucet, amount)?;
    let request = TransactionRequestBuilder::new().build_mint_fungible_asset(
        asset,
        buyer,
        NoteType::Public,
        client.rng(),
    )?;

    let tx_id = client
        .submit_new_transaction(faucet, request)
        .await
        .context("mint transaction failed")?;
    client.sync_state().await.ok();

    let out = serde_json::json!({
        "txId": tx_id.to_hex(),
        "explorer": format!("https://testnet.midenscan.com/tx/{}", tx_id.to_hex()),
    });
    println!("{}", serde_json::to_string(&out)?);
    Ok(())
}
