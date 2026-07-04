// Creates the Guardian multisig accounts for the OPERATOR and JOÃO (seller)
// roles on Bartok-Guardian (threshold 1: role signer + Guardian ACK), and
// records their ids + guardian endpoints in ../accounts.json.
//
// Idempotent: existing accounts (persisted in ../guardian-accounts/<role>/)
// are reused. Run from bartok/miden/integration with Bartok-Guardian up.
use anyhow::{Context, Result};
use integration::helpers::guardian_role_client;

const GUARDIAN_HTTP: &str = "http://localhost:3300";
const GUARDIAN_GRPC: &str = "http://localhost:50052";

#[tokio::main]
async fn main() -> Result<()> {
    let mut ids = std::collections::BTreeMap::new();

    for (role, json_key) in [("operator", "operatorMultisig"), ("joao", "sellerMultisig")] {
        let mut client = guardian_role_client(role, GUARDIAN_GRPC, None).await?;
        // Recover an existing account for this signer from Bartok-Guardian,
        // else create one (idempotent across fresh local stores).
        let recovered = client
            .recover_by_key()
            .await
            .map_err(|e| anyhow::anyhow!("recover_by_key({role}): {e:?}"))?;
        if let Some(acc) = recovered.first() {
            let id = miden_multisig_client::AccountId::from_hex(&acc.account_id)?;
            client
                .pull_account(id)
                .await
                .map_err(|e| anyhow::anyhow!("pull_account({role}): {e:?}"))?;
        } else {
            let commitment = client.user_commitment();
            client
                .create_account(1, vec![commitment])
                .await
                .map_err(|e| anyhow::anyhow!("create_account({role}): {e:?}"))?;
            // create_account is LOCAL-only; this pushes the account state to
            // Bartok-Guardian (configure) so pull/recover work in later sessions.
            client
                .register_on_guardian()
                .await
                .map_err(|e| anyhow::anyhow!("register_on_guardian({role}): {e:?}"))?;
        }
        let id = client
            .account_id()
            .context("account id missing after create")?;
        println!("{role} multisig: {}", id.to_hex());
        ids.insert(json_key.to_string(), id.to_hex());
    }

    // merge into accounts.json
    let path = "../accounts.json";
    let mut accounts: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).context("run setup_accounts first")?)?;
    for (k, v) in ids {
        accounts[k] = serde_json::Value::String(v);
    }
    accounts["guardianHttp"] = serde_json::Value::String(GUARDIAN_HTTP.into());
    accounts["guardianGrpc"] = serde_json::Value::String(GUARDIAN_GRPC.into());
    std::fs::write(path, serde_json::to_string_pretty(&accounts)?)?;
    println!("updated {path}");
    Ok(())
}
