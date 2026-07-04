// BARTOK buyer wallet (vanilla JS, raw @miden-sdk/miden-sdk WASM client).
//
// Mirrors the Rust reference implementation in
// miden/integration/src/bin/smoke_escrow.rs: create-or-load a private wallet,
// absorb BART mints, and build + submit the BartokSettlement escrow note
// (11-felt storage: sellerRecipient, sellerTag, buyerRecipient, buyerTag,
// noteType — recipients precomputed server-side by escrow_params).
import {
  WasmWebClient,
  TransactionProver,
  TransactionRequestBuilder,
  AccountStorageMode,
  AccountId,
  Package,
  NoteScript,
  Note,
  NoteAssets,
  NoteFile,
  NoteId,
  NoteMetadata,
  NoteRecipient,
  NoteStorage,
  NoteTag,
  NoteType,
  NoteArray,
  FeltArray,
  FungibleAsset,
  Felt,
  Word,
} from "@miden-sdk/miden-sdk";

const RPC_URL = "https://rpc.testnet.miden.io";
const PROVER_URL = "https://tx-prover.testnet.miden.io";
const STORE_NAME = "bartok-buyer";
const WALLET_KEY = "bartok-buyer-id";
const MASP_URL = "/packages/bartok-settlement.masp";
// Numeric wasm AuthScheme discriminant for RpoFalcon512 (the friendly string
// const is NOT accepted by newWallet — see frontend-template gotcha).
const AUTH_RPO_FALCON512 = 2;

const randomWord = () =>
  Word.newFromFelts(
    Array.from({ length: 4 }, () => new Felt(BigInt(Math.floor(Math.random() * 2 ** 32)))),
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bytesToB64 = (bytes) => {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
};
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export class BartokWallet {
  /** @type {WasmWebClient} */ client = null;
  wallet = null;
  prover = null;

  async init() {
    // useWorker:false — required so import + tx apply share one SMT forest.
    this.client = await WasmWebClient.createClient(
      RPC_URL, undefined, undefined, STORE_NAME, undefined, false,
    );
    this.prover = TransactionProver.newRemoteProver(PROVER_URL);
    await this.client.syncState();

    const saved = localStorage.getItem(WALLET_KEY);
    if (saved) {
      try {
        this.wallet = await this.client.getAccount(AccountId.fromHex(saved));
      } catch (_) { /* stale id for a wiped store */ }
    }
    if (!this.wallet) {
      this.wallet = await this.client.newWallet(
        AccountStorageMode.private(), AUTH_RPO_FALCON512, undefined,
      );
      localStorage.setItem(WALLET_KEY, this.wallet.id().toString());
    }
    return this.id();
  }

  id() {
    return this.wallet.id().toString();
  }

  async getBalance(faucetHex) {
    const reader = await this.client.accountReader(AccountId.fromHex(this.id()));
    return await reader.getBalance(AccountId.fromHex(faucetHex));
  }

  /** Consume every consumable note for this wallet (mints, refunds). Returns # consumed. */
  async absorbNotes() {
    await this.client.syncState();
    const consumable = await this.client.getConsumableNotes(AccountId.fromHex(this.id()));
    if (!consumable.length) return 0;
    const notes = consumable.map((c) => c.inputNoteRecord().toNote());
    const request = this.client.newConsumeTransactionRequest(notes);
    await this.client.submitNewTransactionWithProver(
      AccountId.fromHex(this.id()), request, this.prover,
    );
    await this.client.syncState();
    return notes.length;
  }

  /** Import a specific public note from the node by id, then absorb it. */
  async absorbNoteById(noteIdHex, timeoutMs = 120000) {
    await this.client.importNoteFile(NoteFile.fromNoteId(NoteId.fromHex(noteIdHex)));
    return this.waitAndAbsorb(timeoutMs);
  }

  /** Import a full serialized NoteFile (private-note rail), then absorb it. */
  async absorbNoteFile(noteFileB64, timeoutMs = 120000) {
    await this.client.importNoteFile(NoteFile.deserialize(b64ToBytes(noteFileB64)));
    return this.waitAndAbsorb(timeoutMs);
  }

  /** Poll until at least one note is absorbed or timeout. Returns # consumed. */
  async waitAndAbsorb(timeoutMs = 120000, everyMs = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const n = await this.absorbNotes();
      if (n > 0) return n;
      await sleep(everyMs);
    }
    return 0;
  }

  /**
   * Build and submit the escrow note from the server-provided template
   * ({sellerRecipient, sellerTag, buyerRecipient, buyerTag, noteType, faucet,
   * operatorTag, budget} — felts as decimal strings). Returns the note id hex.
   */
  async fundEscrow(template) {
    const buf = await fetch(MASP_URL).then((r) => {
      if (!r.ok) throw new Error(`missing ${MASP_URL} — run: npm run build:contracts`);
      return r.arrayBuffer();
    });
    const pkg = Package.deserialize(new Uint8Array(buf));
    const noteScript = NoteScript.fromPackage(pkg);

    const felt = (s) => new Felt(BigInt(s));
    // Order must match the field declaration order in
    // miden/contracts/settlement-note/src/lib.rs (11 felts).
    const storageFelts = [
      ...template.sellerRecipient.map(felt),
      new Felt(BigInt(template.sellerTag)),
      ...template.buyerRecipient.map(felt),
      new Felt(BigInt(template.buyerTag)),
      felt(template.noteType),
    ];
    const recipient = new NoteRecipient(
      randomWord(), noteScript, new NoteStorage(new FeltArray(storageFelts)),
    );
    const metadata = new NoteMetadata(
      this.wallet.id(), NoteType.Private, new NoteTag(template.operatorTag),
    );
    const assets = new NoteAssets([
      new FungibleAsset(AccountId.fromHex(template.faucet), BigInt(template.budget)),
    ]);
    const note = new Note(assets, metadata, recipient);
    // Capture id + serialized bytes BEFORE the note is moved into the request
    // (wasm ownership): the bridge needs the full note details — private notes
    // never publish them on-chain.
    const noteId = note.id().toString();
    const noteB64 = bytesToB64(note.serialize());

    const request = new TransactionRequestBuilder()
      .withOwnOutputNotes(new NoteArray([note]))
      .build();
    await this.client.syncState();
    const txId = await this.client.submitNewTransactionWithProver(
      AccountId.fromHex(this.id()), request, this.prover,
    );
    return { noteId, noteB64, txId: txId.toHex() };
  }
}
