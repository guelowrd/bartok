// BARTOK oracle (zkTLS -> charge): verifies the TLSNotary presentation, extracts the disclosed
// token usage, and computes the settlement charge. This is the off-chain connective tissue between
// the zkTLS proof and the Miden settlement note (charge = total_tokens * PRICE_PER_TOKEN).
//
// (On-chain gating of settlement by an oracle signature is deferred; see repo ARCHITECTURE.md.)
use std::time::Duration;

use tlsn::{
    attestation::{
        presentation::{Presentation, PresentationOutput},
        CryptoProvider,
    },
    verifier::ServerCertVerifier,
    webpki::{CertificateDer, RootCertStore},
};

/// Demo price: one asset base-unit per token.
const PRICE_PER_TOKEN: u64 = 1;

fn mozilla_roots() -> RootCertStore {
    RootCertStore {
        roots: webpki_root_certs::TLS_SERVER_ROOT_CERTS
            .iter()
            .map(|c| CertificateDer(c.to_vec()))
            .collect(),
    }
}

/// Extract the unsigned integer value that follows `"key"` in a (partially disclosed) JSON string.
fn json_uint(s: &str, key: &str) -> Option<u64> {
    let pat = format!("\"{key}\"");
    let start = s.find(&pat)? + pat.len();
    let rest = &s[start..];
    let after_colon = &rest[rest.find(':')? + 1..];
    let digits: String = after_colon
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let presentation: Presentation =
        bincode::deserialize(&std::fs::read("openrouter.presentation.tlsn")?)?;

    // Verify the presentation against the real web PKI (same as the verify example).
    let crypto_provider = CryptoProvider {
        cert: ServerCertVerifier::new(&mozilla_roots())?,
        ..Default::default()
    };
    let PresentationOutput {
        server_name,
        connection_info,
        transcript,
        ..
    } = presentation.verify(&crypto_provider).unwrap();

    let server = server_name.unwrap();
    let time = chrono::DateTime::UNIX_EPOCH + Duration::from_secs(connection_info.time);

    let mut partial = transcript.unwrap();
    partial.set_unauthed(b'X');
    let recv = String::from_utf8_lossy(partial.received_unsafe()).to_string();

    // The `usage` object is disclosed in the presentation; read the verified token total.
    let total = json_uint(&recv, "total_tokens")
        .ok_or("total_tokens not disclosed in the presentation")?;
    let charge = total * PRICE_PER_TOKEN;

    eprintln!("ORACLE: verified zkTLS session with {server} at {time}");
    eprintln!("ORACLE: total_tokens={total}  ->  charge={charge} (price {PRICE_PER_TOKEN}/token)");
    // Machine-readable line for the stitch script (last line of stdout):
    println!("{charge}");
    Ok(())
}
