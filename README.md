# CryptPad recovery

This workspace contains a verified offline recovery utility for the CryptPad
5.1.0 package, target-host acceptance tested against a real account on a
StartOS test server across both 0.3.5.1 and 0.4.0. The intended Phase 7
deployment is a self-contained command-line bundle downloaded from GitHub
and run over SSH. It is explicitly not an `.s9pk` or StartOS service.

The recovery utility can:

- derive a registered account's login-block keys from username/password;
- locate and authenticate/decrypt its account block;
- derive, authenticate, decrypt, and replay its CryptDrive history;
- enumerate ordinary and trashed entries from the logical drive tree;
- authenticate and replay the application-specific histories used by Code,
  Pad, Slide, Kanban, Poll, Whiteboard, Form, and OnlyOffice-backed documents;
- create practical exports for Code (text), Pad (safe offline HTML), Slide
  (Markdown), Kanban (JSON), Poll (CSV), and Whiteboard (Fabric JSON);
- preserve every replayed document as a `.cryptpad.json` raw-state sidecar;
- preserve authenticated secondary edit histories for Sheet, Document, and
  Presentation as `.onlyoffice-history.json`; and
- authenticate and recover uploaded files byte-for-byte, including multi-chunk
  blobs.

It does not contact CryptPad or any outside service during recovery. It reads
an encrypted data snapshot from disk and writes only to an explicitly requested
output directory.

## Standalone SSH usage

Tagged GitHub releases build a Linux x64 archive containing the recovery code,
the exact historical CryptPad dependencies, and Node.js 16.19.0. After
downloading and verifying that archive on StartOS, recovery is started with:

```sh
./cryptpad-recover
```

The program prompts for both the CryptPad username and password. It writes a
timestamped output directory, a separate privacy-safe `support-log.jsonl`, and
a `.tar.gz` archive plus checksum for copying off the server with `scp`.
Detailed download, recovery, copy-out, cleanup, and support procedures are in
[`STANDALONE.md`](STANDALONE.md).
Maintainer release steps are in [`RELEASING.md`](RELEASING.md).

## Development usage

List the recovered drive:

```sh
node bin/cryptpad-recover.js --data testdata/encrypted-phase6
```

Choose a new output directory and skip archive creation when developing:

```sh
node bin/cryptpad-recover.js \
  --data testdata/encrypted-phase6 \
  --output /tmp/cryptpad-recovery-development \
  --no-archive
```

The program prompts for the username and password, with no credential
command-line options. Output files use mode `0600`, directories use mode
`0700`, and the output directory must be new.

## Privacy-safe diagnostic log

Every run creates a structured JSON Lines support log. It records release and
runtime identity, environment/storage probes, stage timings, verified history
message and blob-chunk counts, anonymized per-item outcomes, byte counts, and
sanitized stack traces. It excludes passwords, usernames, user filenames, file
data, absolute paths, capabilities, keys, and CryptPad storage identifiers.

This log is deliberately outside the recovered-files archive. A user can send
the log for investigation without sending recovered private files. Automated
tests verify these exclusions using the live encrypted fixtures.

## Validation

The repository has three encrypted snapshots:

- `testdata/encrypted-phase4`: registered account plus three Code documents;
- `testdata/encrypted-phase5`: the same account plus a 300,123-byte uploaded
  binary spanning three encrypted blob chunks; and
- `testdata/encrypted-phase6`: Pad, Slide, Kanban, and Sheet fixtures added
  through the real CryptPad 5.1.0 browser UI.

All three snapshots are locally marked read-only. Expected plaintext and hashes are
in `fixtures/expected/` and documented in `TEST_FIXTURES.md`.

Aggregate content digests after the final read-only regression were:

```text
encrypted-phase4  4cfaa66c52b07eebfed5281527a1fe86ac8848dd8c0602d77ef4a39cd2b282a8
encrypted-phase5  5995fb12472059c89d638ba478ecf83104b52be03e640d2de32d9e4a629dfdbe
encrypted-phase6  7463cbf2ffc0dbacec316f756a1d5240406e56fc59eccad807f80013639c9630
```

Run the regression tests without putting the password in a process argument:

```sh
read -rsp 'CryptPad test password: ' CRYPTPAD_TEST_PASSWORD
printf '\n'
export CRYPTPAD_TEST_PASSWORD
node --test test/recovery.test.js
unset CRYPTPAD_TEST_PASSWORD
```

The tests prove:

- modern account-block authentication and decryption;
- signature and secretbox verification for every replayed drive/pad message;
- enumeration of the expected logical drive entries;
- exact Code plaintext, Pad HTML, and Slide Markdown recovery;
- semantic Kanban recovery;
- authenticated preservation of the Sheet's primary state and secondary
  OnlyOffice edit stream; and
- uploaded-file metadata plus three-chunk binary recovery with a byte-for-byte
  comparison.

## Export formats

| CryptPad type | Primary recovery output | Additional preservation |
|---|---|---|
| Code | original text | `.cryptpad.json` |
| Pad | sanitized, offline-safe HTML | `.cryptpad.json` HyperJSON state |
| Slide | Markdown | `.cryptpad.json` |
| Kanban | board JSON | `.cryptpad.json` |
| Poll | CSV | `.cryptpad.json` |
| Whiteboard | Fabric canvas JSON | `.cryptpad.json` |
| Sheet, Document, Presentation | raw CryptPad state | authenticated `.onlyoffice-history.json` edit stream when present |
| Form, Calendar, and other replayable apps | raw `.cryptpad.json` state | — |
| Uploaded file | original bytes | — |

The raw sidecars are recovery artifacts, not guaranteed import formats. The
OnlyOffice history is preserved without altering its opaque binary change
strings, but this release does not convert those changes into `.xlsx`, `.docx`,
or `.pptx` files.

## Exact historical code reused

`vendor/cryptpad-5.1.0/` contains the critical files copied from the live
`start9/cryptpad/main:5.1.0` container. The implementation directly loads the
historical versions of:

- `common-credential.js` and `scrypt-async` 1.2.0;
- TweetNaCl 0.12.2;
- `common-hash.js`;
- `chainpad-crypto` 0.2.7; and
- ChainPad 5.2.4 with its SmartJSON transformer.

The small amount of recovery-specific code mirrors the historical login-block,
Netflux framing, filesystem layout, and file-crypto record handling, with source
references in comments.

## Current limitations

The standalone path is implemented for the currently supported formats. The
remaining recovery limitations are:

- only modern login blocks are implemented; legacy v1 account fallback and
  archived-block discovery are pending;
- custom `loginSalt` overrides are not yet loaded from
  `customize/application_config.js`;
- shared folders and teams are not recursively loaded;
- native `.xlsx`, `.docx`, and `.pptx` generation is not implemented; their
  authenticated OnlyOffice edit streams are preserved for future conversion;
- Pad, Slide, Kanban, and Sheet have live encrypted fixtures; Poll, Whiteboard,
  Form, Calendar, Document, and Presentation currently have source-level and
  unit-test coverage but not live UI fixtures;
- damaged/truncated histories and archive fallback need explicit recovery
  policies and diagnostics.

The Phase 6 bundle passed target-host acceptance against a real account on a
StartOS 0.3.5.1 test server (v0.3.0). That run surfaced one real defect fixed
in v0.3.1: two drive items sharing an identical title collided on the same
recovery output path, and the second failed with `OUTPUT_ALREADY_EXISTS`.
`enumerateDrive` now disambiguates every group of same-path items by their
stable drive element id.

v0.3.2 adds StartOS 0.4.0 support: its CryptPad data volume moved from
`/embassy-data/...` to `/media/startos/data/...`, confirmed by inspecting the
0.4.0-upgraded test server's filesystem directly. The default data-root
resolution now tries each known StartOS layout and uses whichever is
actually present, so an upgraded host does not need `--data` passed
manually. Re-run with no `--data` flag against the same real account on the
same test server after its StartOS 0.3.5.1 → 0.4.0.1 upgrade: all 5 drive
items recovered again, with 0 failed and 0 skipped.

`RESEARCH.md` contains the full source and cryptographic analysis. Shared-folder,
team, archive, and damaged-history recovery remain later engineering stages.
