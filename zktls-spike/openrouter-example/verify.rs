// BARTOK zkTLS spike (M2b): verify the OpenRouter presentation against the real
// web PKI. Prints the disclosed bytes; redacted bytes show as `X`.

use std::time::Duration;

use tlsn::{
    attestation::{
        CryptoProvider,
        presentation::{Presentation, PresentationOutput},
        signing::VerifyingKey,
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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let presentation: Presentation =
        bincode::deserialize(&std::fs::read("openrouter.presentation.tlsn")?)?;

    // Verify the server cert chain against the real web PKI.
    let crypto_provider = CryptoProvider {
        cert: ServerCertVerifier::new(&mozilla_roots())?,
        ..Default::default()
    };

    let VerifyingKey { alg, data } = presentation.verifying_key();
    println!(
        "Verifying with notary {alg} key: {}\n(BARTOK: this is the key the oracle would re-sign as Falcon for Miden.)\n",
        hex::encode(data)
    );

    let PresentationOutput {
        server_name,
        connection_info,
        transcript,
        ..
    } = presentation.verify(&crypto_provider).unwrap();

    let time = chrono::DateTime::UNIX_EPOCH + Duration::from_secs(connection_info.time);
    let server_name = server_name.unwrap();
    let mut partial = transcript.unwrap();
    partial.set_unauthed(b'X');

    let sent = String::from_utf8_lossy(partial.sent_unsafe());
    let recv = String::from_utf8_lossy(partial.received_unsafe());

    println!("-------------------------------------------------------------------");
    println!("Verified data from a session with {server_name} at {time}.");
    println!("Undisclosed bytes are shown as X.\n");
    println!("Data sent (request):\n\n{sent}\n");
    println!("Data received (response):\n\n{recv}");
    println!("-------------------------------------------------------------------");
    Ok(())
}
