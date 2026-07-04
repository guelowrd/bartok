// BARTOK zkTLS spike (M2): notarize a REAL OpenRouter chat-completions call.
//
// Proves provenance of a model API response from openrouter.ai using TLSNotary,
// with the real web PKI (Mozilla roots). The notary signs the session
// (Secp256k1 ECDSA). Selective disclosure / Falcon re-signing come later.
//
// Run (needs a free OpenRouter key in ../../.env or the env):
//   OPENROUTER_API_KEY=sk-or-... MODEL=some/model:free \
//     cargo run --release --example openrouter_prove

use std::{env, future::IntoFuture};

use anyhow::Result;
use futures::io::{AsyncReadExt as _, AsyncWriteExt as _};
use http_body_util::Full;
use hyper::{Request, body::Bytes};
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_util::compat::{FuturesAsyncReadCompatExt, TokioAsyncReadCompatExt};
use tracing::info;

use tlsn::{
    Session,
    attestation::{
        Attestation, AttestationConfig, CryptoProvider,
        request::{Request as AttestationRequest, RequestConfig},
        signing::Secp256k1Signer,
    },
    config::{
        prove::ProveConfig, prover::ProverConfig, tls::TlsClientConfig,
        tls_commit::mpc::MpcTlsConfig, verifier::VerifierConfig,
    },
    connection::{CertBinding, ConnectionInfo, HandshakeData, ServerName, TranscriptLength},
    prover::ProverOutput,
    transcript::{ContentType, TranscriptCommitConfig},
    verifier::{VerifierCommitStart, VerifierOutput},
    webpki::{CertificateDer, RootCertStore},
};
use tlsn_formats::http::{DefaultHttpCommitter, HttpCommit, HttpTranscript};

const SERVER_DOMAIN: &str = "openrouter.ai";
const ROUTE: &str = "/api/v1/chat/completions";
const USER_AGENT: &str = "bartok-zktls-spike/0.1";
// MPC preprocessing limits. Keep modest; larger = slower MPC.
const MAX_SENT_DATA: usize = 1 << 12; // 4 KiB (request + headers + body)
const MAX_RECV_DATA: usize = 1 << 16; // 64 KiB (response)

/// Real web-PKI root store (Mozilla roots, DER-encoded).
fn mozilla_roots() -> RootCertStore {
    RootCertStore {
        roots: webpki_root_certs::TLS_SERVER_ROOT_CERTS
            .iter()
            .map(|c| CertificateDer(c.to_vec()))
            .collect(),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let (notary_socket, prover_socket) = tokio::io::duplex(1 << 23);
    tokio::spawn(async move { notary(notary_socket).await.unwrap() });
    prover(prover_socket).await?;
    Ok(())
}

async fn prover<S: AsyncWrite + AsyncRead + Send + Sync + Unpin + 'static>(socket: S) -> Result<()> {
    let api_key = env::var("OPENROUTER_API_KEY")
        .map_err(|_| anyhow::anyhow!("set OPENROUTER_API_KEY (see zktls-spike/.env.example)"))?;
    let model = env::var("MODEL").unwrap_or_else(|_| "meta-llama/llama-3.1-8b-instruct:free".into());
    let prompt = env::var("PROMPT")
        .unwrap_or_else(|_| "In one sentence, what is a zero-knowledge proof?".into());

    // The body we send. max_tokens is the cost ceiling; usage comes back in the response.
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 256,
        "messages": [{ "role": "user", "content": prompt }],
    })
    .to_string();

    // Create a session with the notary.
    let session = Session::new(socket.compat());
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);

    let prover = handle
        .new_prover(ProverConfig::builder().build()?)?
        .commit(
            MpcTlsConfig::builder()
                .max_sent_data(MAX_SENT_DATA)
                .max_recv_data(MAX_RECV_DATA)
                .build()?,
        )
        .await?;

    // Open a TCP connection to the real server (HTTPS / 443).
    let client_socket = tokio::net::TcpStream::connect((SERVER_DOMAIN, 443)).await?;

    // Bind the prover to the server connection using the real web PKI.
    let (tls_connection, prover) = prover.connect(
        TlsClientConfig::builder()
            .server_name(ServerName::Dns(SERVER_DOMAIN.try_into()?))
            .root_store(mozilla_roots())
            .build()?,
        client_socket.compat(),
    )?;
    let tls_connection = TokioIo::new(tls_connection.compat());

    let prover_task = tokio::spawn(prover.into_future());

    let (mut request_sender, connection) =
        hyper::client::conn::http1::handshake(tls_connection).await?;
    tokio::spawn(connection);

    let request = Request::builder()
        .method("POST")
        .uri(ROUTE)
        .header("Host", SERVER_DOMAIN)
        .header("Accept", "*/*")
        .header("Accept-Encoding", "identity")
        .header("Connection", "close")
        .header("User-Agent", USER_AGENT)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {api_key}"))
        .body(Full::<Bytes>::new(Bytes::from(body)))?;

    info!("Sending request to {SERVER_DOMAIN}{ROUTE} (model={model})");
    let response = request_sender.send_request(request).await?;
    let status = response.status();
    info!("Got response: {status}");

    let mut prover = prover_task.await??;

    // Parse + log the response so we can see model/usage in the transcript.
    let transcript = HttpTranscript::parse(prover.transcript())?;
    let response_body = transcript.responses[0].body.as_ref().unwrap();
    let body_bytes = response_body.content_data();
    info!("Response body:\n{}", String::from_utf8_lossy(&body_bytes));
    // Persist the raw response so the bridge can extract the reply text for the UI.
    std::fs::write("openrouter.response.json", &body_bytes)?;

    // Commit to the transcript (request + response, parts committed separately).
    let mut builder = TranscriptCommitConfig::builder(prover.transcript());
    DefaultHttpCommitter::default().commit_transcript(&mut builder, &transcript)?;
    let transcript_commit = builder.build()?;

    let mut builder = RequestConfig::builder();
    builder.transcript_commit(transcript_commit);
    let request_config = builder.build()?;

    let mut builder = ProveConfig::builder(prover.transcript());
    if let Some(config) = request_config.transcript_commit() {
        builder.transcript_commit(config.clone());
    }
    let disclosure_config = builder.build()?;

    let ProverOutput {
        transcript_commitments,
        transcript_secrets,
        ..
    } = prover.prove(&disclosure_config).await?;

    let prover_transcript = prover.transcript().clone();
    let tls_transcript = prover.tls_transcript().clone();
    prover.close().await?;

    let mut builder = AttestationRequest::builder(&request_config);
    builder
        .server_name(ServerName::Dns(SERVER_DOMAIN.try_into().unwrap()))
        .handshake_data(HandshakeData {
            certs: tls_transcript
                .server_cert_chain()
                .expect("server cert chain is present")
                .to_vec(),
            sig: tls_transcript
                .server_signature()
                .expect("server signature is present")
                .clone(),
            binding: tls_transcript.certificate_binding().clone(),
        })
        .transcript(prover_transcript)
        .transcript_commitments(transcript_secrets, transcript_commitments);

    let (request, secrets) = builder.build(&CryptoProvider::default())?;

    handle.close();
    let mut socket = driver_task.await??;

    let request_bytes = bincode::serialize(&request)?;
    socket.write_all(&request_bytes).await?;
    socket.close().await?;

    let mut attestation_bytes = Vec::new();
    socket.read_to_end(&mut attestation_bytes).await?;
    let attestation: Attestation = bincode::deserialize(&attestation_bytes)?;

    let provider = CryptoProvider::default();
    request.validate(&attestation, &provider)?;

    tokio::fs::write("openrouter.attestation.tlsn", bincode::serialize(&attestation)?).await?;
    tokio::fs::write("openrouter.secrets.tlsn", bincode::serialize(&secrets)?).await?;

    println!("\nNotarization completed successfully against {SERVER_DOMAIN}!");
    println!("Wrote openrouter.attestation.tlsn + openrouter.secrets.tlsn");
    Ok(())
}

async fn notary<S: AsyncWrite + AsyncRead + Send + Sync + Unpin + 'static>(socket: S) -> Result<()> {
    let session = Session::new(socket.compat());
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);

    // Notary verifies the real server cert against the real web PKI.
    let verifier_config = VerifierConfig::builder()
        .root_store(mozilla_roots())
        .build()
        .unwrap();

    let verifier = match handle.new_verifier(verifier_config)?.commit().await? {
        VerifierCommitStart::Mpc(verifier) => verifier.accept().await?.run().await?,
        VerifierCommitStart::Proxy(verifier) => {
            verifier.reject(Some("expecting to use MPC-TLS")).await?;
            return Err(anyhow::anyhow!("protocol configuration rejected"));
        }
    };

    let (
        VerifierOutput {
            transcript_commitments,
            ..
        },
        verifier,
    ) = verifier.verify().await?.accept().await?;

    let tls_transcript = verifier.tls_transcript().clone();
    verifier.close().await?;

    let sent_len = tls_transcript
        .sent()
        .iter()
        .filter_map(|r| (r.typ == ContentType::ApplicationData).then_some(r.ciphertext.len()))
        .sum::<usize>();
    let recv_len = tls_transcript
        .recv()
        .iter()
        .filter_map(|r| (r.typ == ContentType::ApplicationData).then_some(r.ciphertext.len()))
        .sum::<usize>();

    handle.close();
    let mut socket = driver_task.await??;

    let mut request_bytes = Vec::new();
    socket.read_to_end(&mut request_bytes).await?;
    let request: AttestationRequest = bincode::deserialize(&request_bytes)?;

    // Notary signing key (Secp256k1), generated by the openrouter_keygen example.
    let key_path = std::env::var("NOTARY_KEY_FILE")
        .unwrap_or_else(|_| "../../keys/notary.secp256k1.hex".into());
    let key_hex = std::fs::read_to_string(&key_path).unwrap_or_else(|e| {
        panic!(
            "notary key not readable at {key_path} ({e}); \
             generate it with: cargo run --release --example openrouter_keygen"
        )
    });
    let key_bytes: [u8; 32] = hex::decode(key_hex.trim())?
        .try_into()
        .map_err(|_| anyhow::anyhow!("notary key file must contain 32 hex-encoded bytes"))?;
    let signing_key = k256::ecdsa::SigningKey::from_bytes(&key_bytes.into())?;
    let signer = Box::new(Secp256k1Signer::new(&signing_key.to_bytes())?);
    let mut provider = CryptoProvider::default();
    provider.signer.set_signer(signer);

    let mut att_config_builder = AttestationConfig::builder();
    att_config_builder.supported_signature_algs(Vec::from_iter(provider.signer.supported_algs()));
    let att_config = att_config_builder.build()?;

    let CertBinding::V1_2(binding) = tls_transcript.certificate_binding() else {
        panic!("unsupported cert binding version");
    };
    let mut builder = Attestation::builder(&att_config).accept_request(request)?;
    builder
        .connection_info(ConnectionInfo {
            time: tls_transcript.time(),
            version: tls_transcript.version(),
            transcript_length: TranscriptLength {
                sent: sent_len as u32,
                received: recv_len as u32,
            },
        })
        .server_ephemeral_key(binding.server_ephemeral_key.clone())
        .transcript_commitments(transcript_commitments);

    let attestation = builder.build(&provider)?;

    let attestation_bytes = bincode::serialize(&attestation)?;
    socket.write_all(&attestation_bytes).await?;
    socket.close().await?;
    Ok(())
}
