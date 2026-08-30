# CryptPad recovery

**This is a work-in-progress recovery utility only, provided as-is and used
at your own risk.** It is not an official CryptPad or Start9 product.
"Tested" here does not mean extensively tested: it has been run
successfully once, end-to-end, against one real user's CryptPad account (5
items, all recovered) on real StartOS servers running both 0.3.5.1 and
0.4.0.1. That is one real-world data point, not broad validation — your
data, document types, or CryptPad configuration may behave differently. The
author takes no responsibility for data loss, corruption, incomplete
recovery, or any other consequence of running this tool, and it is provided
with no warranty of any kind, express or implied, including no warranty of
merchantability or fitness for a particular purpose. Read
[Current limitations](#current-limitations) before relying on it for
anything you can't afford to lose.

This is a self-contained command-line bundle downloaded from GitHub and run
over SSH. It is explicitly not an `.s9pk` or StartOS service.

The recovery utility can:

- derive a registered account's login-block keys from username/password;
- locate and authenticate/decrypt its account block;
- derive, authenticate, decrypt, and replay its CryptDrive history;
- enumerate the entries in the account's drive;
- recover Pad documents as safe, offline HTML; and
- recover uploaded files.

Other CryptPad document types (Code, Slide, Kanban, Poll, Whiteboard, Sheet,
Document, Presentation) are implemented and pass the automated test suite
against real CryptPad-encrypted test fixtures, but have not yet been
exercised against a real end-user account — see
[Export formats](#export-formats) below for exactly what's implemented
versus what's only been validated in the one real run so far.

It does not contact CryptPad or any outside service during recovery. It reads
an encrypted data snapshot from disk and writes only to an explicitly requested
output directory.

## Standalone SSH usage

To recover files using SSH, follow the instructions in
[`StandaloneSSHrecovery.md`](StandaloneSSHrecovery.md). It contains detailed
download, recovery, copy-out, cleanup, and support procedures.

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

These are automated tests against real CryptPad-encrypted fixture data — not
a real end-user account. They prove:

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

Only Pad and uploaded-file recovery have been run against a real end-user
CryptPad account (see the disclaimer at the top of this file). Everything
in the second table below is implemented and passes the automated test
suite described in [Validation](#validation) against real
CryptPad-encrypted test fixtures, but has not yet been exercised on real
account data.

### Tested against a real account

| CryptPad type | Primary recovery output | Additional preservation |
|---|---|---|
| Pad | sanitized, offline-safe HTML | `.cryptpad.json` HyperJSON state |
| Uploaded file | original bytes | — |

### Implemented, not yet tested against a real account

| CryptPad type | Primary recovery output | Additional preservation |
|---|---|---|
| Code | original text | `.cryptpad.json` |
| Slide | Markdown | `.cryptpad.json` |
| Kanban | board JSON | `.cryptpad.json` |
| Poll | CSV | `.cryptpad.json` |
| Whiteboard | Fabric canvas JSON | `.cryptpad.json` |
| Sheet, Document, Presentation | raw CryptPad state | authenticated `.onlyoffice-history.json` edit stream when present |
| Form, Calendar, and other replayable apps | raw `.cryptpad.json` state | — |

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

As of v0.3.2, known limitations:

- only Pad and uploaded-file recovery have been exercised against a real
  end-user account; every other document type is implemented and passes
  automated tests but is otherwise unproven outside test fixtures (see
  [Export formats](#export-formats));
- only modern login blocks are implemented; legacy v1 account fallback and
  archived-block discovery are pending;
- custom `loginSalt` overrides are not yet loaded from
  `customize/application_config.js`;
- shared folders and teams are not recursively loaded;
- native `.xlsx`, `.docx`, and `.pptx` generation is not implemented; their
  authenticated OnlyOffice edit streams are preserved for future conversion;
- damaged/truncated histories and archive fallback need explicit recovery
  policies and diagnostics.

`RESEARCH.md` contains the full source and cryptographic analysis, including
the defects found and fixed during the v0.3.1 and v0.3.2 real-account
acceptance runs. Shared-folder, team, archive, and damaged-history recovery
remain later engineering stages.
