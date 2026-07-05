/** `consume_notes` metadata version. Absence on the wire => v1 (issue #229). */
export const CONSUME_NOTES_METADATA_VERSION_V2 = 2;
/** Max serialized v2 metadata, enforced at creation (FR-011). */
export const MAX_CONSUME_NOTES_METADATA_BYTES = 256 * 1024;
export function isConsumeNotesV2(md) {
    return md.metadataVersion === CONSUME_NOTES_METADATA_VERSION_V2;
}
export function isConsumeNotesV1(md) {
    return md.metadataVersion === undefined || md.metadataVersion === 1;
}
//# sourceMappingURL=proposal.js.map