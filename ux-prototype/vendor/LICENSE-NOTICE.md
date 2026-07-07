# Vendored packages — provenance & licensing

`guardian-client/` and `miden-multisig-client/` are built `dist/` outputs of the
TypeScript packages from OpenZeppelin's Guardian repository
(github.com/OpenZeppelin/guardian, vendored via our fork
github.com/guelowrd/bartok-guardian, branch `bartok`).

Both packages declare `"license": "MIT"` in their package.json. Note that the
Guardian repository as a whole carries an AGPL-3.0 LICENSE file; the Guardian
SERVER we run is used unmodified in spirit (our fork's patches are published in
the fork above), and only these MIT-declared client packages are vendored here.
