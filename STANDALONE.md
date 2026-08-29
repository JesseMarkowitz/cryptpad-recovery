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
RELEASE=v0.3.2
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

With no `--data` flag it tries the CryptPad data directory for each known
StartOS release, newest first, and uses the first one that actually exists:

```text
/media/startos/data/package-data/volumes/cryptpad/data   (StartOS 0.4.0+)
/embassy-data/package-data/volumes/cryptpad/data          (StartOS 0.3.5.1 and earlier)
```

If your StartOS version relocates this path again, or the account's data was
copied somewhere else, pass `--data` explicitly rather than relying on
auto-detection.

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

It also prints ready-to-adapt `scp` commands using the exact paths for that
session; see [Copying files off the server](#copying-files-off-the-server)
below for the general form.

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

This release recovers Code as text, Pad as safe HTML, Slide as Markdown,
Kanban as JSON, Poll as CSV, Whiteboard as Fabric JSON, and uploaded files in
their original bytes. Every replayed document also receives a raw
`.cryptpad.json` sidecar.

CryptPad Sheet, Document, and Presentation edits are stored as OnlyOffice
binary change records. Recovery authenticates and preserves those records in
`.onlyoffice-history.json`; it does not yet render them to `.xlsx`, `.docx`, or
`.pptx`. Form, Calendar, and other replayable applications currently receive
raw-state exports. Shared folders, teams, legacy account fallback, and
damaged/archive histories remain under development.

## Copying files off the server

Run these from a terminal on the computer that should receive the files, not
on the StartOS server. Set `STARTOS_HOST` to the same hostname or address
used for SSH, and `ARCHIVE_PATH`/`LOG_PATH` to the exact paths the utility
printed after `Recovered-files archive:` and `Support log:`. The three `scp`
commands below mirror exactly what the utility itself prints at the end of a
run, with the real paths already filled in and only the host left for you to
substitute; the final checksum-verification line is not printed by the
utility, so run it yourself after copying:

```sh
STARTOS_HOST=YOUR_STARTOS_HOST
ARCHIVE_PATH="/home/start9/.../cryptpad-recovery-<timestamp>-<suffix>.tar.gz"
ARCHIVE_FILE="$(basename "$ARCHIVE_PATH")"
LOG_PATH="/home/start9/.../cryptpad-recovery-<timestamp>-<suffix>/support-log.jsonl"

scp "start9@$STARTOS_HOST:$ARCHIVE_PATH" .
scp "start9@$STARTOS_HOST:$ARCHIVE_PATH.sha256" .
scp "start9@$STARTOS_HOST:$LOG_PATH" .

sha256sum -c "$ARCHIVE_FILE.sha256"
```

`ARCHIVE_FILE` exists because `scp` lands the file under its bare name in the
current directory, while `ARCHIVE_PATH` is the full remote path; `sha256sum
-c` needs the bare name to find it locally. It is safe to send
`support-log.jsonl` for diagnostics; never send the `.tar.gz` archive, since
it contains recovered private data.
