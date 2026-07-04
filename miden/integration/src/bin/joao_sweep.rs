// Béla ops tool: drains João's pending Guardian proposals (e.g. consume
// proposals whose execution raced block inclusion) by executing them now.
use anyhow::{Context, Result};
use integration::helpers::guardian_role_client;
use miden_client::account::AccountId;

#[tokio::main]
async fn main() -> Result<()> {
    let accounts: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string("../accounts.json")?)?;
    let seller = AccountId::from_hex(accounts["sellerMultisig"].as_str().context("sellerMultisig")?)?;
    let grpc = accounts["guardianGrpc"].as_str().context("guardianGrpc")?;

    let mut joao = guardian_role_client("joao", grpc, Some(seller)).await?;
    joao.sync().await.ok();
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
