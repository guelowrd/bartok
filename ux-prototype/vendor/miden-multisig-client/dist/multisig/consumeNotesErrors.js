/**
 * v2 metadata's embedded `notes` array did not match its declared
 * `noteIds` — either a length mismatch, or an embedded note whose
 * `note.id()` did not match the corresponding `noteIds[i]`. Spec FR-007.
 */
export class NoteBindingMismatchError extends Error {
    code = 'consume_notes_note_binding_mismatch';
    constructor(message) {
        super(message);
        this.name = 'NoteBindingMismatchError';
    }
}
/**
 * `metadataVersion` is a value the client does not support — either a
 * legacy (v1) proposal on a cut-over client, or an unrecognized future
 * version. Spec FR-009 / FR-019.
 */
export class UnsupportedMetadataVersionError extends Error {
    code = 'consume_notes_unsupported_metadata_version';
    found;
    constructor(found, message) {
        super(message ??
            `unsupported consume_notes metadata version: ${found === undefined ? 'absent' : String(found)}`);
        this.name = 'UnsupportedMetadataVersionError';
        this.found = found;
    }
}
/**
 * Serialized v2 metadata exceeded the per-proposal cap
 * (`MAX_CONSUME_NOTES_METADATA_BYTES`, 256 KiB). Raised at proposal-
 * creation time before any signature collection begins. Spec FR-011.
 */
export class ConsumeNotesMetadataOversizeError extends Error {
    code = 'consume_notes_metadata_oversize';
    limit;
    actual;
    constructor(limit, actual) {
        super(`consume_notes metadata exceeds size limit: limit=${limit} bytes, actual=${actual} bytes`);
        this.name = 'ConsumeNotesMetadataOversizeError';
        this.limit = limit;
        this.actual = actual;
    }
}
/**
 * v1 (legacy) verification path: the cosigner's local Miden store did
 * not contain the referenced note. This is the exact failure issue #229
 * exists to eliminate; on v2 proposals it is not reachable.
 */
export class LegacyConsumeNotesNoteMissingError extends Error {
    code = 'consume_notes_legacy_note_missing';
    noteId;
    constructor(noteId) {
        super(`consume_notes legacy verification: note not found in local store: ${noteId}`);
        this.name = 'LegacyConsumeNotesNoteMissingError';
        this.noteId = noteId;
    }
}
//# sourceMappingURL=consumeNotesErrors.js.map