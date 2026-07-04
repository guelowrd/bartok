// BARTOK zkTLS spike (M2b): build a selective-disclosure presentation from the
// OpenRouter attestation.
//
// Reveals what BARTOK's settlement contract needs and nothing else:
//   request : method/target + headers, with the Authorization value REDACTED,
//             plus request body `model` and `max_tokens` (the cost ceiling)
//   response: status + headers, plus body `model`, `id`, and `usage.*` (billing)
// Everything else (the prompt content and the answer content) stays redacted.

use hyper::header;

use tlsn::attestation::{Attestation, CryptoProvider, Secrets, presentation::Presentation};
use tlsn_formats::http::{BodyContent, HttpTranscript};
use tlsn_formats::json::JsonValue;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let attestation: Attestation =
        bincode::deserialize(&std::fs::read("openrouter.attestation.tlsn")?)?;
    let secrets: Secrets = bincode::deserialize(&std::fs::read("openrouter.secrets.tlsn")?)?;

    let transcript = HttpTranscript::parse(secrets.transcript())?;
    let mut builder = secrets.transcript_proof_builder();

    // ---- request: prove the call shape, redact the API key ----
    let request = &transcript.requests[0];
    builder.reveal_sent(request.without_data())?;
    builder.reveal_sent(&request.request.target)?;
    for h in &request.headers {
        if h.name.as_str().eq_ignore_ascii_case(header::AUTHORIZATION.as_str()) {
            // reveal that an Authorization header was present, hide its value (the key)
            builder.reveal_sent(h.without_value())?;
        } else {
            builder.reveal_sent(h)?;
        }
    }
    // Reveal request body `model` and `max_tokens` as full key-value pairs
    // (label + value, so the verifier knows WHICH field the bytes are);
    // keep the prompt (messages) hidden.
    if let Some(body) = request.body.as_ref() {
        if let BodyContent::Json(doc) = &body.content {
            if let JsonValue::Object(obj) = &doc.root {
            for kv in &obj.elems {
                if ["model", "max_tokens"].contains(&kv.key.view().as_str().as_ref()) {
                    builder.reveal_sent(kv.clone())?;
                }
            }
            }
        }
    }

    // ---- response: prove model + usage, redact the answer content ----
    let response = &transcript.responses[0];
    builder.reveal_recv(response.without_data())?;
    for h in &response.headers {
        builder.reveal_recv(h)?;
    }
    if let Some(body) = response.body.as_ref() {
        if let BodyContent::Json(doc) = &body.content {
            if let JsonValue::Object(obj) = &doc.root {
            for path in ["id", "model", "usage"] {
                match obj.elems.iter().find(|kv| kv.key.view().as_str() == path) {
                    Some(kv) => {
                        builder.reveal_recv(kv.clone())?;
                    },
                    None => eprintln!("note: response field `{path}` not present, skipping"),
                }
            }
            }
        }
    }

    let transcript_proof = builder.build()?;

    let provider = CryptoProvider::default();
    let mut builder = attestation.presentation_builder(&provider);
    builder
        .identity_proof(secrets.identity_proof())
        .transcript_proof(transcript_proof);
    let presentation: Presentation = builder.build()?;

    std::fs::write("openrouter.presentation.tlsn", bincode::serialize(&presentation)?)?;
    println!("Presentation built -> openrouter.presentation.tlsn");
    Ok(())
}
