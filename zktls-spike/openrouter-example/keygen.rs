// Generates the BARTOK notary/oracle secp256k1 keypair.
//
// Writes (relative to the tlsn checkout the examples run from):
//   ../../keys/notary.secp256k1.hex  (32-byte secret, 0600)
//   ../../keys/notary.pub.hex        (SEC1 compressed verifying key)
//
// Refuses to overwrite existing keys — delete the files to regenerate.
use std::os::unix::fs::PermissionsExt;

use k256::elliptic_curve::rand_core::OsRng;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = std::env::var("NOTARY_KEY_DIR").unwrap_or_else(|_| "../../keys".into());
    let secret_path = format!("{dir}/notary.secp256k1.hex");
    let pub_path = format!("{dir}/notary.pub.hex");

    if std::path::Path::new(&secret_path).exists() || std::path::Path::new(&pub_path).exists() {
        return Err(format!(
            "refusing to overwrite existing keys in {dir}; delete them to regenerate"
        )
        .into());
    }
    std::fs::create_dir_all(&dir)?;

    let signing_key = k256::ecdsa::SigningKey::random(&mut OsRng);
    let pub_compressed = signing_key
        .verifying_key()
        .to_encoded_point(true)
        .as_bytes()
        .to_vec();

    std::fs::write(&secret_path, hex::encode(signing_key.to_bytes()))?;
    std::fs::set_permissions(&secret_path, std::fs::Permissions::from_mode(0o600))?;
    std::fs::write(&pub_path, hex::encode(&pub_compressed))?;

    println!("wrote {secret_path} (0600)");
    println!("wrote {pub_path} ({})", hex::encode(pub_compressed));
    Ok(())
}
