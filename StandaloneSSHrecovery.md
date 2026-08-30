# Standalone CryptPad recovery over SSH

This is a command-line recovery utility, not a StartOS package or service. It
runs locally on a StartOS server over SSH, reads CryptPad's encrypted data, and
writes recovered files into a new directory. It does not modify CryptPad data
or contact a CryptPad server.

The Linux x64 release archive includes its own Node.js runtime. Do not download
GitHub's automatically generated "Source code" archives; those do not contain
the runtime.

This guide has four steps, and **which machine you run each one on matters**
— get it wrong and a command will simply fail to find the file it's looking
for:

1. Download and verify — on the **StartOS server**
2. Run recovery — on the **StartOS server**
3. Copy the recovered files to your local machine — on **your local machine**
4. Clean up the StartOS server — back on the **StartOS server**

## Step 1: Download and verify — on the StartOS server

SSH into the StartOS server. Every command in this step runs there:

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

The checksum command must report `OK`. Stop if it does not. At this point,
you have downloaded the recovery tool and confirmed its SHA-256 checksum.

## Step 2: Run recovery — on the StartOS server

Still on the StartOS server, in the directory the archive just extracted
into. Run the utility without `sudo` first:

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
auto-detection:

```sh
./cryptpad-recover --data /path/to/copied/cryptpad/data
```

The utility prompts for the CryptPad username and password. Neither credential
is accepted as a command-line argument. The password is not echoed, retained,
or written to the support log.

The destination can also be chosen explicitly, but it must not already exist:

```sh
./cryptpad-recover --output "$PWD/my-recovery-session"
```

The source is only opened for reading. New directories use mode `0700`, files
use mode `0600`, and existing output files are never overwritten.

On completion the utility prints three paths. **Keep this terminal open, or
write the paths down** — you'll need two of them for Step 3, and the third
for Step 4:

- a `.tar.gz` archive containing only recovered files;
- the archive's `.sha256` checksum (same path, with `.sha256` appended); and
- `support-log.jsonl`, a separate diagnostic log.

It also prints ready-to-adapt `scp` commands using the exact paths for that
session, matching Step 3 below.

**Example output** (yours will show your own username, item count, and
paths — this is illustrative, not a template to copy):

```text
CryptPad username: alice
CryptPad password:
Found 5 drive items. Recovering supported items...
[1/5] Recovered pad item (2 output files).
[2/5] Recovered pad item (2 output files).
[3/5] Recovered file item (1 output file).
[4/5] Recovered file item (1 output file).
[5/5] Recovered file item (1 output file).
Recovery success: 5 recovered, 0 failed, 0 skipped.
Support log: /home/start9/cryptpad-recovery-0.3.2-linux-x64/cryptpad-recovery-20260830T140512Z-a1b2c3/support-log.jsonl
Recovered-files archive: /home/start9/cryptpad-recovery-0.3.2-linux-x64/cryptpad-recovery-20260830T140512Z-a1b2c3.tar.gz

Copy the recovered-files archive from a terminal on your other computer:
  scp start9@YOUR_STARTOS_HOST:"/home/start9/cryptpad-recovery-0.3.2-linux-x64/cryptpad-recovery-20260830T140512Z-a1b2c3.tar.gz" .
  scp start9@YOUR_STARTOS_HOST:"/home/start9/cryptpad-recovery-0.3.2-linux-x64/cryptpad-recovery-20260830T140512Z-a1b2c3.tar.gz.sha256" .

If support is needed, send only this diagnostic log (it contains no passwords, filenames, or file data):
  scp start9@YOUR_STARTOS_HOST:"/home/start9/cryptpad-recovery-0.3.2-linux-x64/cryptpad-recovery-20260830T140512Z-a1b2c3/support-log.jsonl" .

Do not send the recovered-files archive for diagnostics; it contains recovered private data.
```

## Step 3: Copy the recovered files to your local machine — on your local machine

Open a **new terminal on the computer that should receive the files** — not
the StartOS server you were just using. Everything below runs on this local
machine. Set `STARTOS_HOST` to the same hostname or address you used for
SSH, then replace the two `REPLACE_WITH_...` placeholders with the exact
paths the utility printed in Step 2 after `Recovered-files archive:` and
`Support log:` — paste those two lines verbatim; do not abbreviate or
paraphrase them. The `scp` commands then use `STARTOS_HOST`, `ARCHIVE_PATH`,
and `LOG_PATH` to copy those files **from** the StartOS server **to** the
current directory on this local machine — the same copy the utility's own
printed commands in Step 2 do, just written with variables here instead of
one fixed hostname. The final checksum-verification line is not printed by
the utility at all; run it yourself after copying:

```sh
STARTOS_HOST=YOUR_STARTOS_HOST
ARCHIVE_PATH=REPLACE_WITH_THE_PRINTED_RECOVERED-FILES_ARCHIVE_PATH
ARCHIVE_FILE="$(basename "$ARCHIVE_PATH")"
LOG_PATH=REPLACE_WITH_THE_PRINTED_SUPPORT_LOG_PATH

scp "start9@$STARTOS_HOST:$ARCHIVE_PATH" .
scp "start9@$STARTOS_HOST:$ARCHIVE_PATH.sha256" .
scp "start9@$STARTOS_HOST:$LOG_PATH" .

sha256sum -c "$ARCHIVE_FILE.sha256"
```

A real `ARCHIVE_PATH` looks like
`/home/start9/cryptpad-recovery-<version>-linux-x64/cryptpad-recovery-<timestamp>-<suffix>.tar.gz`
— always copy it from the utility's own output rather than retyping it, since
the directory you ran it from and the session suffix both vary per run.

`ARCHIVE_FILE` exists because `scp` lands the file under its bare name in the
current directory, while `ARCHIVE_PATH` is the full remote path; `sha256sum
-c` needs the bare name to find it locally.

The checksum command above must report `OK` — this confirms the copy itself
wasn't corrupted in transit, the same way Step 1's checksum confirmed the
download wasn't. Only proceed once it passes, and only extract on a trusted
computer, since the archive contains your private recovered data:

```sh
tar -xzf "$ARCHIVE_FILE"
```

This command takes the archive file that was copied locally and extracts it
to a newly created local directory called `recovered-files`.

Keep this local copy — it's the only one you'll have once Step 4 removes the
server's copy. It is safe to send `support-log.jsonl` to CryptPad support if
you need help; never send the `.tar.gz` archive or its extracted contents,
since those contain your recovered private data.

## Step 4: Clean up the StartOS server — back on the StartOS server

Go back to the terminal you used in Steps 1–2 (or open a new SSH session to
the same StartOS server). **Do this only after Step 3's `sha256sum -c`
reported `OK`** — that's your proof the files survived the copy intact, so
it's safe to remove the server's copy.

**Why this matters:** the recovery utility only ever adds files — it never
deletes anything itself. After a run, your StartOS server is left holding two
separate, unencrypted copies of your recovered CryptPad content: the
individual files under `recovered-files/`, and the same content again inside
the `.tar.gz`. Both are readable by anyone who can log in as the account
that ran the utility (`start9` by default). Once your local copy from Step 3
is verified, there is no reason for a plaintext copy to keep sitting on the
server.

Paste the same archive path from Step 3 — you're deriving the session
directory from it, then removing the directory, the archive, and its
checksum together:

```sh
ARCHIVE_PATH=REPLACE_WITH_THE_PRINTED_RECOVERED-FILES_ARCHIVE_PATH
SESSION_DIR="${ARCHIVE_PATH%.tar.gz}"

rm -rf "$SESSION_DIR" "$ARCHIVE_PATH" "$ARCHIVE_PATH.sha256"
```

`SESSION_DIR` is the directory the archive was built from — it contains
`recovered-files/` and `support-log.jsonl`. For example, if `ARCHIVE_PATH` is
`/home/start9/cryptpad-recovery-0.3.2-linux-x64/cryptpad-recovery-20260829T232757Z-d3a3f0.tar.gz`,
then `SESSION_DIR` is
`/home/start9/cryptpad-recovery-0.3.2-linux-x64/cryptpad-recovery-20260829T232757Z-d3a3f0`.
This only removes that one recovery session's output — it does not touch the
downloaded release bundle (`cryptpad-recovery-<version>-linux-x64/` and its
own `.tar.gz`) that Step 1 extracted, so `./cryptpad-recover` is still there
to run again later if needed.

`rm -rf` is permanent and cannot be undone. Double-check your local copy from
Step 3 is complete before running this — you already have `support-log.jsonl`
from Step 3 too, so there's no need to keep a server-side copy even if you
might send it for support later.

## Support log and privacy

The support log records information needed to reproduce and diagnose a
failure: tool/build identity, runtime and StartOS versions, storage probes,
recovery stages, verified message/chunk counts, anonymized per-item
outcomes, byte counts, timings, error codes, and sanitized stack traces. It
does not record:

- passwords or password values;
- usernames;
- document or uploaded-file names;
- document contents or uploaded-file data;
- CryptPad capabilities, keys, channel identifiers, or block identifiers; or
- absolute source/output paths.

The log is created with mode `0600`. Review it before sending if desired;
each line is one JSON object. If recovery fails or is incomplete, send only
`support-log.jsonl` for diagnostics — never the recovered-files archive.

## Current format limitations

Only Pad and uploaded-file recovery have been run against a real end-user
account (see the disclaimer in `README.md`); everything else below is
implemented and passes automated tests, but has not yet been proven outside
test fixtures.

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
