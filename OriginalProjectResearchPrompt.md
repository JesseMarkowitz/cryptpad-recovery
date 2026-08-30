> **Status:** this is the original project brief, written before any research
> or code existed. All seven phases described below are now complete and
> released (`v0.3.2` as of this writing) — see `README.md` for what the tool
> actually does today, `StandaloneSSHrecovery.md` for how to run it, and
> `RESEARCH.md` for the research and validation record this brief asked for.
> Kept here unmodified as the historical record of original scope and
> constraints. This file was itself originally named `background.md`.

We are building a standalone CryptPad data-recovery utility for CryptPad installations running on StartOS 0.3.5.1.

## Background

A user had CryptPad installed and functioning on StartOS 0.3.5.1.

They upgraded their StartOS server to StartOS 0.4.0 without first creating a backup. Their old CryptPad package is not compatible with StartOS 0.4.0, so they can no longer access CryptPad normally.

The goal is to determine whether we can recover the user's CryptPad documents directly from the persistent CryptPad data using the user's known CryptPad username and password.

CryptPad is client-side encrypted. The server stores encrypted account and document data. The username/password are used by the CryptPad browser/client code to derive the credentials or keys needed to access the user's account metadata/CryptDrive, which in turn contains or references the keys needed to decrypt individual documents.

Do NOT assume that the username/password are directly used as document encryption keys.

We need to understand and reproduce the actual CryptPad account-login and document-decryption process for the exact version of CryptPad packaged for StartOS 0.3.5.1.

## Test environment

I have a separate StartOS 0.3.5.1 test server on my local network.

It has a working CryptPad installation with test accounts and test documents.

You may SSH into that test server for research.

I will provide the SSH hostname/address and credentials or SSH setup separately.

Treat the remote StartOS server as READ-ONLY unless I explicitly authorize changes.

You may freely:

* inspect files
* run find
* run grep/rg
* use cat/head/tail/sed
* inspect processes
* inspect filesystem mounts
* inspect Docker/container configuration
* inspect CryptPad source
* inspect StartOS package source/configuration
* inspect package manifests
* inspect persistent-volume paths
* copy files FROM the test server into this local development workspace for analysis
* inspect JavaScript
* inspect package versions/dependencies
* use git
* download/reference upstream open-source CryptPad source when useful
* create and modify files in this local repository
* write exploratory scripts
* run local tests

Do NOT, without explicit authorization:

* modify files on the remote StartOS server
* restart services
* stop services
* uninstall packages
* upgrade packages
* alter the CryptPad datastore
* alter test-user data
* delete anything
* perform destructive Git operations

## Primary research questions

Determine all of the following.

### 1. Exact CryptPad version

Identify exactly which CryptPad version/commit/package is used by the StartOS 0.3.5.1 CryptPad package.

Do not assume current CryptPad behavior matches this version.

Locate the actual StartOS CryptPad package source if possible and determine:

* CryptPad upstream version
* commit/tag
* package modifications/patches
* configuration
* persistent directories
* environment variables
* container layout

### 2. Persistent-data layout

Determine exactly what CryptPad data persists on StartOS 0.3.5.1 and where.

Investigate directories such as, but do not assume these names are complete:

* datastore
* blob
* block
* pins
* decree
* config
* customize
* accounts
* anything else required for recovery

Document what each persistent directory contains.

Determine whether all required data survives independently of the running CryptPad container.

### 3. Account/login cryptography

Trace the exact source-code path executed when a CryptPad user enters:

* username
* password

Determine exactly:

* normalization rules
* encoding
* key-derivation algorithm
* hash algorithm
* KDF parameters
* salts
* iterations/work factors
* account identifiers derived
* signing/encryption keys derived
* account block lookup mechanism
* account block format
* encryption primitive
* nonce/IV handling
* authentication/MAC mechanism

Cite source filenames and functions in our research notes.

Do not describe it only conceptually. Trace the actual implementation.

### 4. CryptDrive/account metadata

Determine how the decrypted account information leads to the user's CryptDrive.

Determine:

* where CryptDrive metadata is stored
* how it is encrypted
* how it is addressed
* how its encryption key is obtained
* how document references are represented
* whether filenames/folder hierarchy are encrypted
* how shared documents differ from owned documents
* how deleted/archived items appear

### 5. Document cryptography

Trace the exact code necessary to turn a CryptPad document reference into plaintext.

Determine:

* how document/channel IDs are derived
* where document ciphertext is stored
* how the document key is obtained
* symmetric encryption primitive
* key size
* nonce mechanism
* authentication mechanism
* framing/block format
* any history/CRDT reconstruction required

CryptPad documents may not exist as a single encrypted file. Determine whether recovery requires replaying operation history or reconstructing application state.

### 6. Blobs/uploads

Determine separately how uploaded files/blobs are encrypted and recovered.

We ultimately want ordinary files exported to disk when possible.

### 7. Application-specific export

Identify document/application types likely to be encountered:

* rich text
* spreadsheets
* code/text
* presentations
* forms
* kanban
* whiteboards
* uploaded files
* other CryptPad types

Determine what level of recovery is practical:

A. raw decrypted CryptPad state
B. plain text
C. HTML
D. original uploaded binary
E. native application export formats
F. another useful representation

Do not overpromise export fidelity.

## Desired recovery program

The ultimate deliverable should be a standalone program that can be copied to a StartOS 0.3.5.1 server and run through SSH.

Conceptual usage could eventually look something like:

```
cryptpad-recover USERNAME
```

It should securely prompt for the password rather than accepting the password on the command line.

Possible interaction:

```
CryptPad username: alice
CryptPad password:

Account found.
CryptDrive decrypted.

Found 37 accessible items:
  1. Documents/Taxes/2025 Notes
  2. Documents/Project A
  3. Photos/document.pdf
  ...
```

The user should then be able to recover individual files or everything into a destination directory.

Do not commit to this exact UI yet. First determine what is technically feasible.

## Security requirements

This is a recovery tool for data belonging to a user who knows their CryptPad credentials.

The program must:

* never transmit credentials elsewhere
* never log passwords
* never store plaintext passwords
* avoid exposing passwords via shell history or process arguments
* perform recovery locally
* default to read-only access to CryptPad's datastore
* never modify the original CryptPad data
* preferably operate against a copied/snapshotted data directory when practical
* clearly separate recovered plaintext output from encrypted source data

We want no dependency on an outside CryptPad service.

## Deployment constraints

The eventual utility must be usable by a person who can:

1. SSH into their StartOS server.
2. Copy the recovery program onto it.
3. Run a small number of commands.
4. Enter their CryptPad username/password.
5. Recover their files.

Do not assume they are a developer.

Minimize external dependencies.

Before choosing implementation language, inspect what runtimes and libraries are actually available on StartOS 0.3.5.1.

Because CryptPad itself is JavaScript/Node-based, reusing the original CryptPad JavaScript crypto routines may be substantially safer than rewriting cryptography in another language. Investigate that first.

Where practical, import/reuse original CryptPad source rather than manually reimplementing cryptographic primitives.

## Development strategy

Work in stages.

### Phase 1 — reconnaissance

Do not build the final tool yet.

Inspect:

* test StartOS server
* StartOS package
* CryptPad persistent data
* exact CryptPad source
* login code
* crypto code
* drive code
* document storage

Write findings into:

```
RESEARCH.md
```

Include source paths, functions, data structures, algorithms and unanswered questions.

### Phase 2 — prove account recovery

Using ONLY the test account and test data:

Write a minimal local proof-of-concept that accepts the test username/password and proves that we can locate and decrypt the user's CryptPad account/CryptDrive metadata.

Do not proceed until this works.

### Phase 3 — enumerate drive

Extend the proof-of-concept to enumerate the files/folders visible in the test user's CryptDrive.

Output:

* logical path
* type
* document/channel identifier
* enough metadata to investigate recovery

### Phase 4 — recover one simple document

Choose a simple text/rich-text test document.

Recover it from persistent encrypted storage into readable plaintext or another clearly inspectable representation.

Compare it with the original test document.

### Phase 5 — uploaded binary

Recover one uploaded test file byte-for-byte and compare hashes with the original.

### Phase 6 — broader recovery

Investigate/recover additional CryptPad document types.

### Phase 7 — standalone utility

Only after the underlying recovery path is proven, turn the proof-of-concept into the standalone user-facing utility.

The agreed deployment is **not** an `.s9pk` and not a long-running StartOS
service. It is a self-contained Linux x64 release bundle downloaded from GitHub
after the user connects to StartOS over SSH. The bundle must include its own
runtime, prompt for username and password, recover into a separate directory,
create an archive and checksum that are easy to copy off the server with
`scp`, and generate a detailed privacy-safe support log.

The support log must contain enough build, environment, stage, verification,
count, timing, and sanitized error information for remote diagnosis. It must
not contain passwords, usernames, actual user filenames, file data, absolute
source/output paths, CryptPad capabilities or keys, or storage identifiers.

## Validation

For every recovery mechanism:

1. Create or identify known test content.
2. Record expected plaintext/content/hash.
3. Recover it only from persistent CryptPad data plus username/password.
4. Compare recovered output against the known original.
5. Document the result.

We need evidence that the recovery path works, not merely a theoretical interpretation of CryptPad's source.

## Important design principle

The ideal implementation probably does NOT "break CryptPad encryption."

Instead, it should recreate the legitimate browser-side recovery path:

```
username + password
    ↓
CryptPad account key derivation
    ↓
encrypted account block
    ↓
CryptDrive metadata
    ↓
document references + document keys
    ↓
encrypted document history/data
    ↓
recovered document
```

Where possible, use the exact original CryptPad code responsible for these transformations.

Begin with Phase 1.

Inspect the environment thoroughly and create RESEARCH.md.

Do not begin writing the final recovery program until the encryption/storage architecture has been demonstrated from actual source code and actual test data.
