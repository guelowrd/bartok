// BARTOK oracle (zkTLS -> charge): verifies the TLSNotary presentation against
// the known notary key, extracts the disclosed token usage and model, and
// computes the settlement charge (charge = total_tokens * PRICE_PER_TOKEN).
//
// The last stdout line is machine-readable JSON:
//   {"total_tokens":N,"charge":N,"model":"...","notary_ok":true}
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

fn mozilla_roots() -> RootCertStore {
    RootCertStore {
        roots: webpki_root_certs::TLS_SERVER_ROOT_CERTS
            .iter()
            .map(|c| CertificateDer(c.to_vec()))
            .collect(),
    }
}

/// Slice the balanced `{...}` object that follows `"key":` in a partially
/// disclosed JSON string (the full body cannot be parsed — undisclosed bytes
/// are replaced with 'X').
fn json_object_fragment<'a>(s: &'a str, key: &str) -> Option<&'a str> {
    let pat = format!("\"{key}\"");
    let start = s.find(&pat)? + pat.len();
    let rest = &s[start..];
    let open = rest.find('{')?;
    let mut depth = 0usize;
    for (i, c) in rest[open..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&rest[open..open + i + 1]);
                }
            },
            _ => {},
        }
    }
    None
}

/// Extract the string value that follows `"key":` in a partially disclosed JSON string.
fn json_string(s: &str, key: &str) -> Option<String> {
    let pat = format!("\"{key}\"");
    let start = s.find(&pat)? + pat.len();
    let rest = &s[start..];
    let after_colon = rest[rest.find(':')? + 1..].trim_start();
    let inner = after_colon.strip_prefix('"')?;
    Some(inner[..inner.find('"')?].to_string())
}

#[derive(serde::Deserialize)]
struct Usage {
    total_tokens: u64,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let price_per_token: u64 = std::env::var("PRICE_PER_TOKEN")
        .map_err(|_| "PRICE_PER_TOKEN env var is required (units per token)")?
        .parse()
        .map_err(|_| "PRICE_PER_TOKEN must be a u64")?;

    let presentation: Presentation =
        bincode::deserialize(&std::fs::read("openrouter.presentation.tlsn")?)?;

    // Only presentations signed by OUR notary key are acceptable.
    let pub_path = std::env::var("NOTARY_PUB_FILE")
        .unwrap_or_else(|_| "../../keys/notary.pub.hex".into());
    let expected_pub = std::fs::read_to_string(&pub_path)
        .map_err(|e| {
            format!(
                "notary pubkey not readable at {pub_path} ({e}); \
                 generate keys with: cargo run --release --example openrouter_keygen"
            )
        })?
        .trim()
        .to_lowercase();
    let actual_pub = hex::encode(&presentation.verifying_key().data);
    if actual_pub != expected_pub {
        eprintln!("ORACLE: REJECTED — presentation signed by unknown notary {actual_pub}");
        std::process::exit(2);
    }

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

    // The `usage` object and response `model` are disclosed in the presentation.
    let usage_fragment =
        json_object_fragment(&recv, "usage").ok_or("usage not disclosed in the presentation")?;
    let usage: Usage = serde_json::from_str(usage_fragment)
        .map_err(|e| format!("disclosed usage is not valid JSON ({e}): {usage_fragment}"))?;
    let model = json_string(&recv, "model").ok_or("model not disclosed in the presentation")?;
    let charge = usage.total_tokens * price_per_token;

    eprintln!("ORACLE: verified zkTLS session with {server} at {time} (notary ok)");
    eprintln!(
        "ORACLE: model={model} total_tokens={}  ->  charge={charge} (price {price_per_token}/token)",
        usage.total_tokens
    );
    // Machine-readable line for the bridge (last line of stdout):
    println!(
        "{}",
        serde_json::json!({
            "total_tokens": usage.total_tokens,
            "charge": charge,
            "model": model,
            "notary_ok": true,
        })
    );
    Ok(())
}
