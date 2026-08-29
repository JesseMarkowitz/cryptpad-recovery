# Standalone CryptPad recovery over SSH

This is a command-line recovery utility, not a StartOS package or service. It
runs locally on a StartOS server over SSH, reads CryptPad's encrypted data, and
writes recovered files into a new directory. It does not modify CryptPad data
or contact a CryptPad server.

The Linux x64 release archive includes its own Node.js runtime. Do not download
GitHub's automatically generated "Source code" archives; those do not contain
the runtime.

## Download and verify

SSH into the StartOS server, then download a named release archive and its
checksum from this project's GitHub Releases page:

```sh
RELEASE=v0.2.0
ASSET="cryptpad-recovery-${RELEASE#v}-linux-x64.tar.gz"
BASE_URL="https://github.com/JesseMarkowitz/cryptpad-recovery/releases/download"
curl -fLO "$BASE_URL/$RELEASE/$ASSET"
curl -fLO "$BASE_URL/$RELEASE/$ASSET.sha256"
sha256sum -c "$ASSET.sha256"
tar -xzf "$ASSET"
cd "${ASSET%.tar.gz}"
```

The checksum command must report `OK`. Stop if it does not.

## Run recovery

Run the utility without `sudo` first:

```sh
./cryptpad-recover
```

It uses this StartOS 0.3.5.1 CryptPad data directory by default:

```text
/embassy-data/package-data/volumes/cryptpad/data
```

The utility prompts for the CryptPad username and password. Neither credential
is accepted as a command-line argument. The password is not echoed, retained,
or written to the support log.

For data copied somewhere else, specify its root explicitly:

```sh
./cryptpad-recover --data /path/to/copied/cryptpad/data
```

The destination can also be chosen explicitly, but it must not already exist:

```sh
./cryptpad-recover --output "$PWD/my-recovery-session"
```

The source is only opened for reading. New directories use mode `0700`, files
use mode `0600`, and existing output files are never overwritten.

## Results and copying them off StartOS

On completion the utility prints paths to:

- a `.tar.gz` archive containing only recovered files;
- the archive's `.sha256` checksum; and
- `support-log.jsonl`, a separate diagnostic log.

It also prints ready-to-adapt `scp` commands. Run those commands from a terminal
on the computer that should receive the files, after replacing
`YOUR_STARTOS_HOST` with the same hostname or address used for SSH.

Verify the copied recovery archive:

```sh
sha256sum -c cryptpad-recovery-*.tar.gz.sha256
```

Extract it only on a trusted computer because it contains private recovered
data:

```sh
tar -xzf cryptpad-recovery-*.tar.gz
```

## Support log and privacy

If recovery fails or is incomplete, copy and send only `support-log.jsonl`.
Never send the recovered-files archive for diagnostics.

The support log records information needed to reproduce and diagnose a failure:
tool/build identity, runtime and StartOS versions, storage probes, recovery
stages, verified message/chunk counts, anonymized per-item outcomes, byte counts,
timings, error codes, and sanitized stack traces. It does not record:

- passwords or password values;
- usernames;
- document or uploaded-file names;
- document contents or uploaded-file data;
- CryptPad capabilities, keys, channel identifiers, or block identifiers; or
- absolute source/output paths.

The log is created with mode `0600`. Review it before sending if desired; each
line is one JSON object.

## Current format limitations

This release recovers CryptPad Code documents as text and uploaded files in
their original bytes. Other app types, shared folders, teams, legacy account
fallback, and damaged/archive histories are still under development. Unsupported
items are counted and reported without exposing their names in the support log.
