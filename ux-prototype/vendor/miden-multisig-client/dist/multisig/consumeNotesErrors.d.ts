/**
 * Stable error identifiers for the `consume_notes` v2 metadata flow
 * (issue #229). These string codes are pinned identical to the Rust
 * SDK's `MultisigError::code()` values per spec FR-021 / FR-022, so
 * cross-SDK tests and operator diagnostics share one taxonomy.
 */
export type ConsumeNotesErrorCode = 'consume_notes_note_binding_mismatch' | 'consume_notes_unsupported_metadata_version' | 'consume_notes_metadata_oversize' | 'consume_notes_legacy_note_missing';
/**
 * v2 metadata's embedded `notes` array did not match its declared
 * `noteIds` — either a length mismatch, or an embedded note whose
 * `note.id()` did not match the corresponding `noteIds[i]`. Spec FR-007.
 */
export declare class NoteBindingMismatchError extends Error {
    readonly code: ConsumeNotesErrorCode;
    constructor(message: string);
}
/**
 * `metadataVersion` is a value the client does not support — either a
 * legacy (v1) proposal on a cut-over client, or an unrecognized future
 * version. Spec FR-009 / FR-019.
 */
export declare class UnsupportedMetadataVersionError extends Error {
    readonly code: ConsumeNotesErrorCode;
    readonly found: number | undefined;
    constructor(found: number | undefined, message?: string);
}
/**
 * Serialized v2 metadata exceeded the per-proposal cap
 * (`MAX_CONSUME_NOTES_METADATA_BYTES`, 256 KiB). Raised at proposal-
 * creation time before any signature collection begins. Spec FR-011.
 */
export declare class ConsumeNotesMetadataOversizeError extends Error {
    readonly code: ConsumeNotesErrorCode;
    readonly limit: number;
    readonly actual: number;
    constructor(limit: number, actual: number);
}
/**
 * v1 (legacy) verification path: the cosigner's local Miden store did
 * not contain the referenced note. This is the exact failure issue #229
 * exists to eliminate; on v2 proposals it is not reachable.
 */
export declare class LegacyConsumeNotesNoteMissingError extends Error {
    readonly code: ConsumeNotesErrorCode;
    readonly noteId: string;
    constructor(noteId: string);
}
//# sourceMappingURL=consumeNotesErrors.d.ts.map