# CryptPad recovery

This workspace contains a verified offline recovery utility for the CryptPad
5.1.0 package installed on the StartOS 0.3.5.1 test server. The intended Phase
7 deployment is a self-contained command-line bundle downloaded from GitHub
and run over SSH. It is explicitly not an `.s9pk` or StartOS service.

The proof of concept can:

- derive a registered account's login-block keys from username/password;
- locate and authenticate/decrypt its account block;
- derive, authenticate, decrypt, and replay its CryptDrive history;
- enumerate ordinary and trashed entries from the logical drive tree;
- authenticate, replay, and export CryptPad Code documents as plaintext; and
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
Detailed download, recovery, copy-out, and support procedures are in
[`STANDALONE.md`](STANDALONE.md).
Maintainer release steps are in [`RELEASING.md`](RELEASING.md).

## Development usage

List the recovered drive:

```sh
node bin/cryptpad-recover.js --data testdata/encrypted-phase5
```

Choose a new output directory and skip archive creation when developing:

```sh
node bin/cryptpad-recover.js \
  --data testdata/encrypted-phase5 \
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

The repository has two encrypted snapshots:

- `testdata/encrypted-phase4`: registered account plus three Code documents;
- `testdata/encrypted-phase5`: the same account plus a 300,123-byte uploaded
  binary spanning three encrypted blob chunks.

Both snapshots are locally marked read-only. Expected plaintext and hashes are
in `fixtures/expected/` and documented in `TEST_FIXTURES.md`.

Aggregate content digests after the final read-only regression were:

```text
encrypted-phase4  4cfaa66c52b07eebfed5281527a1fe86ac8848dd8c0602d77ef4a39cd2b282a8
encrypted-phase5  5995fb12472059c89d638ba478ecf83104b52be03e640d2de32d9e4a629dfdbe
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
- exact Code plaintext recovery; and
- uploaded-file metadata plus three-chunk binary recovery with a byte-for-byte
  comparison.

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
- Code and uploaded-file exports are implemented, while other application
  types currently require raw-state/export adapters;
- damaged/truncated histories and archive fallback need explicit recovery
  policies and diagnostics; and
- GitHub repository/release publication is pending; the generated standalone
  bundle has passed target-host acceptance on `cryptpad-test`.

`RESEARCH.md` contains the full source and cryptographic analysis. Broader
format and shared-folder recovery remains the next recovery-engineering stage.
