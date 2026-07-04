// BARTOK buyer wallet — Rita's account is a Guardian MULTISIG (threshold-1
// Falcon signer + Bartok-Guardian ACK). Backup/recovery come free; every
// value-moving action is a Guardian-countersigned proposal.
//
// Public surface kept stable for index.html: init(), id(), getBalance(),
// fund()/waitAndAbsorb() (mint consume), fundEscrow() (custom proposal),
// absorbNoteFile() (private refund consume).
import { MidenClient, AuthSecretKey, AccountId } from "@miden-sdk/miden-sdk";
import { MultisigClient, FalconSigner, AccountInspector } from "@openzeppelin/miden-multisig-client";

const RPC_URL = "https://rpc.testnet.miden.io";

const STORE_NAME = "bartok-rita";
const ACCOUNT_KEY = "bartok-rita-account";
const SIGNER_KEY = "bartok-rita-signer"; // hex of AuthSecretKey.serialize()
// Bartok-Guardian gRPC (proxied by Vite in dev, tunnelled in prod).
const GUARDIAN_URL = "http://localhost:3300";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const hexToBytes = (h) => Uint8Array.from(h.match(/.{2}/g).map((x) => parseInt(x, 16)));
const bytesToB64 = (b) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// Guardian allows one pending (non-canonical) delta per account. Back-to-back
// proposals race that rule; retry on 409 until the prior delta settles.
async function withPendingRetry(fn, { tries = 20, everyMs = 6000 } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = String(e && e.message || e);
      if (i < tries && /conflict_pending_delta|non-canonical delta pending/i.test(msg)) {
        await new Promise((r) => setTimeout(r, everyMs));
        continue;
      }
      throw e;
    }
  }
}

export class BartokWallet {
  /** @type {MidenClient} */ client = null;
  /** @type {MultisigClient} */ msClient = null;
  multisig = null;   // the Multisig account handle
  signer = null;

  async init() {
    // MidenClient carries the testnet remote prover (defaultProver), which the
    // multisig client offloads proving to. Reads go through getOrImport (below)
    // to re-register the account in this client's SMT forest after a multisig
    // write updates the shared store.
    this.client = await MidenClient.createTestnet({ storeName: STORE_NAME, proverUrl: "testnet" });
    await this.client.sync();

    // Persistent Falcon signer (never regenerate — that would orphan the account).
    const savedSigner = localStorage.getItem(SIGNER_KEY);
    const secret = savedSigner
      ? AuthSecretKey.deserialize(hexToBytes(savedSigner))
      : AuthSecretKey.rpoFalconWithRNG();
    if (!savedSigner) localStorage.setItem(SIGNER_KEY, bytesToHex(secret.serialize()));
    this.signer = new FalconSigner(secret);

    this.msClient = new MultisigClient(this.client, {
      guardianEndpoint: GUARDIAN_URL,
      midenRpcEndpoint: RPC_URL,
    });

    const savedAccount = localStorage.getItem(ACCOUNT_KEY);
    if (savedAccount) {
      this.multisig = await this.msClient.load(savedAccount, this.signer);
    } else {
      // Try recovery (same signer, wiped store) before creating a new account.
      const recovered = await this.msClient.recoverByKey(this.signer).catch(() => []);
      if (recovered.length) {
        this.multisig = await this.msClient.load(recovered[0].accountId, this.signer);
      } else {
        const guardian = await this.msClient.guardianClient.getPubkey();
        const guardianCommitment = typeof guardian === "string" ? guardian : guardian.commitment;
        this.multisig = await this.msClient.create(
          { threshold: 1, signerCommitments: [this.signer.commitment], guardianCommitment,
            guardianEnabled: true, storageMode: "private", signatureScheme: "falcon" },
          this.signer,
        );
        await this.multisig.registerOnGuardian();
      }
      localStorage.setItem(ACCOUNT_KEY, this.multisig.accountId);
    }
    await this.multisig.syncState();
    return this.id();
  }

  id() { return this.multisig.accountId; }

  async getBalance(faucetHex) {
    await this.client.sync();
    // getOrImport re-registers the (multisig-updated) account in this client's
    // forest; read the local vault directly. NOT multisig.syncState() — its
    // overwrite guard throws while a just-executed delta is still canonicalizing.
    const account = await this.client.accounts.getOrImport(this.id());
    const bal = AccountInspector.fromAccount(account).vaultBalances
      .find((v) => v.faucetId.toLowerCase() === faucetHex.toLowerCase());
    return bal ? bal.amount : 0n;
  }

  /** Consume every available note (mints, refunds) via a Guardian consume proposal. */
  async absorbNotes() {
    await this.client.sync();
    const available = await this.client.notes.listAvailable({ account: this.id() });
    if (!available.length) return 0;
    const ids = available.map((r) => r.id().toString());
    const proposal = await withPendingRetry(() => this.multisig.createConsumeNotesProposal(ids));
    await this.multisig.signProposal(proposal.id);
    await withPendingRetry(() => this.multisig.executeProposal(proposal.id));
    await this.client.sync();
    return ids.length;
  }

  async waitAndAbsorb(timeoutMs = 180000, everyMs = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const n = await this.absorbNotes().catch(() => 0);
      if (n > 0) return n;
      await sleep(everyMs);
    }
    return 0;
  }

  /** Import a private note file (refund) into the store, then consume it. */
  async absorbNoteFile(noteFileB64, timeoutMs = 180000) {
    const { NoteFile } = await import("@miden-sdk/miden-sdk");
    await this.client.notes.import(NoteFile.deserialize(b64ToBytes(noteFileB64)));
    return this.waitAndAbsorb(timeoutMs);
  }

  /**
   * Fund the escrow via a Guardian custom proposal. The escrow TransactionRequest
   * is built in Rust (bridge) and passed as bytes, so this wallet never
   * constructs SDK Felt/Note objects — that would fork a second @miden-sdk WASM
   * instance next to the multisig client's and wasm-bindgen rejects cross-instance
   * values. Deterministic: propose → sign → prepare → submit, all over bytes.
   */
  async fundEscrow(template) {
    const requestBytes = b64ToBytes(template.requestB64);
    const proposal = await withPendingRetry(() =>
      this.multisig.createCustomProposal(requestBytes, "bartok_escrow"));
    await this.multisig.signProposal(proposal.id);
    const advice = await this.multisig.prepareCustomExecution(proposal.id, requestBytes);
    await withPendingRetry(() => this.multisig.submitCustomFromBytes(requestBytes, advice));
    // The note id lives in the note bytes the bridge already holds; return them.
    return { noteB64: template.noteB64 };
  }
}
