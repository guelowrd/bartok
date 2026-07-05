import type { MidenClient, Note, TransactionRequest, WasmWebClient, Word } from '@miden-sdk/miden-sdk';
import type { SignatureOptions } from './options.js';
/**
 * Build a consume-notes request from loaded `Note` objects (no local-store
 * read). v2 verification path for issue #229.
 */
export declare function buildConsumeNotesTransactionRequestFromNotes(notes: Note[], options?: SignatureOptions): {
    request: TransactionRequest;
    salt: Word;
};
/**
 * Legacy/creation adapter: fetches notes from the local store and delegates
 * to the from-notes variant. v2 verification MUST NOT call this.
 */
export declare function buildConsumeNotesTransactionRequest(client: MidenClient | WasmWebClient, noteIds: string[], options?: SignatureOptions): Promise<{
    request: TransactionRequest;
    salt: Word;
}>;
//# sourceMappingURL=consumeNotes.d.ts.map