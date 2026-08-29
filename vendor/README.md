# Vendored historical CryptPad components

The files under `cryptpad-5.1.0/` were copied directly from the running
`start9/cryptpad/main:5.1.0` container on `cryptpad-test` on 2026-08-29. The
container embeds upstream CryptPad commit
`291b6dcce629e1cce07fec76390505f777884f47` (tag `5.1.0`).

Only components required to trace or execute the recovery path were copied.
The recovery runtime directly imports the historical credential, capability,
TweetNaCl, chainpad-crypto, and ChainPad modules. `node_modules/chainpad-crypto`
is a Node-resolution copy of the exact browser `crypto.js`; its small
`package.json` records the live resolved version.

Upstream license files are retained beside CryptPad, ChainPad,
chainpad-crypto, and scrypt-async. TweetNaCl's package metadata declares the
Unlicense and its upstream README is retained in the package directory.

Exact package/image provenance and critical source hashes are recorded in
`../RESEARCH.md`.
