//! Common helper functions for scripts and tests (trimmed from the v0.15
//! agentic-template project-template; counter-specific helpers dropped).

use std::{path::Path, sync::Arc};

use anyhow::{bail, Context, Result};
use cargo_miden::run;
use miden_client::{
    account::{
        component::{
            BasicWallet, BurnPolicyConfig, FungibleFaucet, MintPolicyConfig, PolicyRegistration,
            TokenName, TokenPolicyManager,
        },
        Account, AccountBuilder, AccountBuilderSchemaCommitmentExt, AccountType,
    },
    asset::{AssetAmount, TokenSymbol},
    auth::{AuthSchemeId, AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    keystore::{FilesystemKeyStore, Keystore},
    rpc::{Endpoint, GrpcClient},
    utils::Deserializable,
    Client,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use miden_mast_package::Package;
use rand::RngCore;

/// Test setup configuration containing initialized client and keystore
pub struct ClientSetup {
    /// The configured Miden client instance.
    pub client: Client<FilesystemKeyStore>,
    /// The filesystem-backed keystore used by the client.
    pub keystore: Arc<FilesystemKeyStore>,
}

/// Initializes client + keystore against testnet.
///
/// State lives next to the workspace: `../keystore` and `../store.sqlite3`
/// relative to the `integration/` crate (same layout as the template).
pub async fn setup_client() -> Result<ClientSetup> {
    let endpoint = Endpoint::testnet();
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(GrpcClient::new(&endpoint, timeout_ms));

    let keystore_path = std::path::PathBuf::from("../keystore");
    let keystore =
        Arc::new(FilesystemKeyStore::new(keystore_path).context("Failed to initialize keystore")?);

    let store_path = std::path::PathBuf::from("../store.sqlite3");

    let client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(store_path)
        .authenticator(keystore.clone())
        .in_debug_mode(true.into())
        .build()
        .await
        .context("Failed to build Miden client")?;

    Ok(ClientSetup { client, keystore })
}

/// Builds a Miden project in the specified directory, returning the compiled `Package`.
pub fn build_project_in_dir(dir: &Path, release: bool) -> Result<Package> {
    let profile = if release { "--release" } else { "--debug" };
    let manifest_path = dir.join("Cargo.toml");
    let manifest_arg = manifest_path.to_string_lossy();

    let args = vec![
        "cargo",
        "miden",
        "build",
        profile,
        "--manifest-path",
        &manifest_arg,
    ];

    let output = run(args.into_iter().map(String::from))
        .context("Failed to compile project")?
        .context("Cargo miden build returned None")?;

    let artifact_path = match output {
        cargo_miden::CommandOutput::BuildCommandOutput { output } => output
            .into_iter()
            .next()
            .context("cargo miden build produced no artifact")?,
        other => bail!("Expected BuildCommandOutput, got {:?}", other),
    };

    let package_bytes = std::fs::read(&artifact_path).context(format!(
        "Failed to read compiled package from {}",
        artifact_path.display()
    ))?;

    Package::read_from_bytes(&package_bytes).context("Failed to deserialize package from bytes")
}

/// Builds the 13-felt BartokSettlement note storage — the single source of
/// truth for the layout. Field order MUST match the `#[note]` struct in
/// contracts/settlement-note/src/lib.rs. Every escrow construction site (bins +
/// tests) goes through here so the recipient/tag felts and the operator gate
/// (last two felts) can never drift between sites.
pub fn settlement_storage(
    seller_recipient: miden_client::Word,
    seller_tag: miden_client::note::NoteTag,
    buyer_recipient: miden_client::Word,
    buyer_tag: miden_client::note::NoteTag,
    note_type: miden_client::note::NoteType,
    operator: miden_client::account::AccountId,
) -> Result<miden_client::note::NoteStorage> {
    use miden_client::Felt;
    miden_client::note::NoteStorage::new(vec![
        seller_recipient[0], seller_recipient[1], seller_recipient[2], seller_recipient[3],
        Felt::from(seller_tag),
        buyer_recipient[0], buyer_recipient[1], buyer_recipient[2], buyer_recipient[3],
        Felt::from(buyer_tag),
        Felt::from(note_type),
        operator.prefix().as_felt(),
        operator.suffix(),
    ])
    .context("build settlement note storage")
}

/// Creates a basic wallet account (Falcon512Poseidon2 auth, key stored in the keystore).
pub async fn create_basic_wallet_account(
    client: &mut Client<FilesystemKeyStore>,
    keystore: Arc<FilesystemKeyStore>,
    account_type: AccountType,
) -> Result<Account> {
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

    let account = AccountBuilder::new(init_seed)
        .account_type(account_type)
        .with_auth_component(AuthSingleSig::new(
            key_pair.public_key().to_commitment(),
            AuthSchemeId::Falcon512Poseidon2,
        ))
        .with_component(BasicWallet)
        .build()
        .context("Failed to build basic wallet account")?;

    client
        .add_account(&account, false)
        .await
        .context("Failed to add account to client")?;

    keystore
        .add_key(&key_pair, account.id())
        .await
        .context("Failed to add key to keystore")?;

    Ok(account)
}

/// Creates a basic fungible faucet account (Falcon512Poseidon2 auth).
pub async fn create_basic_faucet_account(
    client: &mut Client<FilesystemKeyStore>,
    keystore: Arc<FilesystemKeyStore>,
    symbol: &str,
    decimals: u8,
    max_supply: u64,
) -> Result<Account> {
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

    let token_symbol = TokenSymbol::new(symbol).context("invalid token symbol")?;
    let token_name = TokenName::new(symbol).context("invalid token name")?;
    let faucet_component = FungibleFaucet::builder()
        .name(token_name)
        .symbol(token_symbol)
        .decimals(decimals)
        .max_supply(AssetAmount::new(max_supply).context("invalid max supply")?)
        .build()
        .context("failed to build faucet component")?;

    // Mint/burn policies only — transfer policies would install asset-callback
    // slots that break `FungibleAsset::new`-constructed assets (see miden-client
    // test_utils/common.rs for the full explanation).
    let policy_manager = TokenPolicyManager::new()
        .with_mint_policy(MintPolicyConfig::AllowAll, PolicyRegistration::Active)
        .context("mint policy")?
        .with_burn_policy(BurnPolicyConfig::AllowAll, PolicyRegistration::Active)
        .context("burn policy")?;

    let account = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_auth_component(AuthSingleSig::new(
            key_pair.public_key().to_commitment(),
            AuthSchemeId::Falcon512Poseidon2,
        ))
        .with_component(faucet_component)
        .with_components(policy_manager)
        .build_with_schema_commitment()
        .context("Failed to build faucet account")?;

    client
        .add_account(&account, false)
        .await
        .context("Failed to add faucet account to client")?;

    keystore
        .add_key(&key_pair, account.id())
        .await
        .context("Failed to add faucet key to keystore")?;

    Ok(account)
}

// ---- Bartok-Guardian multisig plumbing (cycle 2) ----------------------------

/// Loads (or creates on first use) a persistent Falcon signer secret for a
/// Guardian multisig role and returns a MultisigClient rooted in
/// `../guardian-accounts/<role>/` (account store + signer, gitignored).
pub async fn guardian_role_client(
    role: &str,
    guardian_grpc: &str,
    known_account: Option<miden_client::account::AccountId>,
) -> Result<miden_multisig_client::MultisigClient> {
    use miden_client::utils::Serializable;
    use miden_multisig_client::SecretKey as FalconSecretKey;

    let dir = std::path::PathBuf::from(format!("../guardian-accounts/{role}"));
    std::fs::create_dir_all(&dir).context("create guardian account dir")?;
    let key_path = dir.join("signer.hex");

    let secret = if key_path.exists() {
        let bytes = hex::decode(std::fs::read_to_string(&key_path)?.trim())
            .context("bad signer hex")?;
        FalconSecretKey::read_from_bytes(&bytes)
            .map_err(|e| anyhow::anyhow!("signer deserialize: {e:?}"))?
    } else {
        let sk = FalconSecretKey::new();
        std::fs::write(&key_path, hex::encode(sk.to_bytes()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600))?;
        }
        sk
    };

    let mut client = miden_multisig_client::MultisigClient::builder()
        .miden_endpoint(Endpoint::testnet())
        .guardian_endpoint(guardian_grpc)
        .account_dir(&dir)
        .with_secret_key(secret)
        .build()
        .await
        .map_err(|e| anyhow::anyhow!("multisig client build ({role}): {e:?}"))?;

    // Each session starts with a fresh local store (by SDK design); hydrate
    // the role's account from Bartok-Guardian when we already know its id.
    if let Some(id) = known_account {
        client
            .pull_account(id)
            .await
            .map_err(|e| anyhow::anyhow!("pull_account({role}): {e:?}"))?;
    }
    Ok(client)
}
