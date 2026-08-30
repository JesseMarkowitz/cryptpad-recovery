# CryptPad recovery research: StartOS 0.3.5.1 and 0.4.0

Research date: 2026-08-28. Sections 15–16 extend this research to StartOS
0.4.0 as of 2026-08-29; everything before that was written against 0.3.5.1
only, which is still the version most of this document's live-verified
claims describe.

Post-reconnaissance fixture update: on 2026-08-28 a registered test account and
three owned Code documents were created through the normal CryptPad 5.1.0
client. Their expected plaintext and hashes are recorded in
`TEST_FIXTURES.md`. Statements below that the live volumes were empty describe
the Phase 1 observation before these fixtures were added.

## Status and evidence labels

This document began as Phase 1 reconnaissance. Sections 12–16 record the
later implemented and empirically validated recovery phases, and the two
StartOS-upgrade acceptance findings after release. Test-only CryptPad data
was created through the normal browser UI; production data was not
modified.

The source-level recovery path is technically credible: the account password
does not encrypt documents directly. It deterministically locates and decrypts
an account block; that block contains a random CryptDrive capability; the
decrypted drive contains document and file capabilities; those capabilities
decrypt the corresponding histories or blobs.

Evidence labels used below:

- **Source-verified**: established from the exact historical StartOS package or
  the exact CryptPad source it embeds.
- **Live-verified**: observed read-only on `cryptpad-test`, the StartOS 0.3.5.1
  test server, on 2026-08-28.
- **Empirical validation pending**: must be demonstrated with the known test
  account and test content in Phases 2-5.

The package, runtime, configuration, mounts, source hashes, and empty volume
layout have now been checked live. The server currently has no test account or
document ciphertext, so representative data files remain unavailable for
format inspection and Phases 2-5 cannot yet be validated against it.

## 1. Exact package and source provenance

### StartOS package

**Source-verified and live-verified.** The historical package is the archived repository
[`Start9Labs/cryptpad-startos`](https://github.com/Start9Labs/cryptpad-startos),
not the current StartOS CryptPad package.

- The live host reports StartOS `0.3.5.1` in `/usr/lib/startos/VERSION.txt`.
- The installed/running image is `start9/cryptpad/main:5.1.0`, image ID
  `574ea42e52ee626f942e20077689c2a7548298272baab9358fb3080703d6f62b`,
  manifest digest
  `sha256:ee4eea12f2c8087ecd6ff4d085b1bc45cf219a3142c8e0ec104a02f2aaa55c10`.
- The retained package archive is
  `/embassy-data/package-data/archive/cryptpad/5.1.0/cryptpad.s9pk`; its SHA-256
  is `38ccd789c501b6e4aa44db16dca52c4bde5a4c434ad3e761dffd52725268225b`.
- Package tag `v5.1.0` is wrapper commit
  `8845b714fbea1b4c4bde50b08afd7ebd02a59cae`; the image was built on
  2022-12-19 from its functional parent
  `785f89b8a0ff189d6b6897aaffe316f91cf0de43`.
- [`manifest.yaml`](https://github.com/Start9Labs/cryptpad-startos/blob/8845b714fbea1b4c4bde50b08afd7ebd02a59cae/manifest.yaml)
  declares package version `5.1.0`.
- The package's `cryptpad-docker` gitlink is
  `6eb9525fdef75b5236b9f6cabc8e89644a9698fd`.
- The original `xwiki-labs/cryptpad-docker` repository is no longer available,
  but that exact object survives in the archival fork
  [`MrViso/cryptpad-docker`](https://github.com/MrViso/cryptpad-docker/commit/6eb9525fdef75b5236b9f6cabc8e89644a9698fd).
  Its `cryptpad` gitlink is exactly
  `291b6dcce629e1cce07fec76390505f777884f47`.
- Upstream commit
  [`291b6dcce629e1cce07fec76390505f777884f47`](https://github.com/cryptpad/cryptpad/tree/291b6dcce629e1cce07fec76390505f777884f47)
  is tag `5.1.0`; upstream and live-image `package.json` both say `5.1.0`.

This establishes the core CryptPad source exactly. It is not an assumption
based only on the package's version string.

The repository later gained a 5.2.1 package, but that is **not** the image
installed on this test server. StartOS version alone does not determine an app
version, so recovery must identify the actual retained package/image on every
target rather than assuming 5.1.0 universally.

### Package modifications

**Source-verified.** The StartOS wrapper does not patch CryptPad application
source. Its build:

1. starts from `node:16-alpine`;
2. copies the historical Docker helper, whose `cryptpad` submodule is the exact
   upstream commit above;
3. replaces upstream `config/config.example.js` with the wrapper's
   [`config.example.js`](https://github.com/Start9Labs/cryptpad-startos/blob/8845b714fbea1b4c4bde50b08afd7ebd02a59cae/config.example.js);
4. changes `httpAddress` to `0.0.0.0` and `installMethod` to
   `docker-alpine`;
5. runs `npm install --production` and `bower install --allow-root`;
6. copies the built tree into a fresh `node:16-alpine` runtime and adds bash,
   curl, tini, and yq.

The wrapper config differs from the upstream 5.1.0 example only by removing the
literal empty `adminKeys` declaration. The entrypoint optionally inserts
`adminKeys` and `adminEmail` from StartOS configuration and sets the LAN/Tor
origins.

At each start,
[`docker_entrypoint.sh`](https://github.com/Start9Labs/cryptpad-startos/blob/8845b714fbea1b4c4bde50b08afd7ebd02a59cae/docker_entrypoint.sh)
copies the example to `/cryptpad/config/config.js`, substitutes origins and
optional administrative settings, then executes `tini npm start` from
`/cryptpad`. Unlike the later 5.2.1 package, this image has no nginx layer and
does not run `npm run build` in its StartOS entrypoint.

The manifest supplies no application environment-variable map. The entrypoint
uses shell variables internally: `CPAD_CONF`, `TOR_ADDRESS`,
`SANDBOX_TOR_ADDRESS`, derived `LAN_ADDRESS`/`SANDBOX_LAN_ADDRESS`,
`CPAD_MAIN_DOMAIN`, `CPAD_SANDBOX_DOMAIN`, and `PROTOCOL`; optional
`ADMIN_PUBLIC_KEY` and `ADMIN_EMAIL` values are read from
`/cryptpad/main/start9/config.yaml`. These are used for file substitution, not
as a separate runtime secret store.

CryptPad's Node process uses its default port 3000 (and normally the adjacent
sandbox port 3001). The 5.1.0 manifest maps both StartOS `main` and `sandbox`
interfaces to container port 3000 under distinct LAN/Tor hostnames. The live
processes are `tini npm start`, `npm start`, `node server.js`, and one
`lib/workers/db-worker` child.

The generated `config/config.js` is container-local, not one of the six mounted
volumes. It is reproducible from the package and `/cryptpad/main/start9/config.yaml`.

### Exact build-resolved dependencies

The upstream npm tree has a lockfile, but browser `bower.json` uses ranges and
the package build ran Bower without a lockfile. The live image's `.bower.json`
resolution metadata and file hashes remove that ambiguity:

| Component | Constraint | Exact live version and commit |
|---|---:|---|
| `tweetnacl` | `0.12.2` | `0.12.2`, `8a21381d696acdc4e99c9f706f1ad23285795f79` |
| `scrypt-async` | `1.2.0` | `1.2.0`, `b57c602a29b73323b1bd4723575dedff16b64f73` |
| `chainpad-crypto` | `^0.2.0` | `0.2.7`, `c8b76b895f67719a3b799daac3d832fdfea45613` |
| `chainpad` | `^5.2.0` | `5.2.4`, `a7b1eff94a2bc33345c11758339e522dad65dbf6` |
| `chainpad-listmap` | `^1.0.0` | `1.0.1`, `1ed90edf3c20ce9ba230d26c983b04de240f7b2a` |
| `chainpad-netflux` | transitive | `1.0.0`, `66ef76ed364e757a878bbff435e7c94613c4c70c` |

The installed server dependencies additionally include `chainpad-server 5.1.0`,
`express 4.16.4`, and TweetNaCl 0.12.2. SHA-256 hashes of the critical installed
files match upstream CryptPad 5.1.0 and the exact dependency packages, including
login, credentials, block crypto, hash parsing, drive logic, history keeper,
file/blob crypto, ChainPad, listmap, and netflux. The recovery implementation
must vendor these versions rather than silently substitute current releases.

Selected SHA-256 values recorded directly from the live image provide a
second identity check:

```text
845658861cf3a5e8093bb7724a935c930c3886340c51f750a02f79db8f0339c7  customize.dist/login.js
ebd333146f9372d8dc29c815ab69a7b92c07a18110e0b56c909dc0cb7b65fe88  www/common/common-credential.js
bfaa88e5759fd53e228536f91b7e722ec61cd31dccb8030b086ba9f176bbae4d  www/common/outer/login-block.js
629267aad8efaef741f85f5d95e6ba340a8092c707efd1ed094467453e0dce3f  www/common/common-hash.js
84944306f6f3a9de39644a63e7134e6437b402ab992cc5f1045c85450289304e  www/common/userObject.js
57019960c6597b7d88db2db69a9597591c69710432e54da00baf15b96962393c  www/common/outer/sharedfolder.js
8c9a4994b724f8cfc4e288eb39bedb0adb09dd65aefff7c8e2f058fe6d23c519  www/file/file-crypto.js
a14cc4dba7cc8a37f557af89c3ef29819d00e41519e14f0d55841d11442f45da  lib/hk-util.js
e210acdfccb317f7fb93871bc1b54f5f8ccd2861d084e550d3b08677c22f3b58  lib/storage/file.js
df2e7d5c36cfe0cfd500839e6111eccbcb60b6156ff50591fb05e5740f32115a  lib/storage/blob.js
ba494f7c3ebcd15270261aeb28a218f87945442cb748ac487f685028cf6b2aea  chainpad-crypto/crypto.js
5b62a52b809203b358409019a09c26c68d606aeb3904e54d709c657032ed0f88  chainpad/chainpad.dist.js
b6c94d04d2bf7a0a70e8d708520758b1e19086ac2dc54f3c161ef5fed53fd9e8  chainpad-listmap/chainpad-listmap.js
729f68bb825b8557ba4b25f928c903b138e0db762256daf438c9fe6eccbf9e8d  chainpad-netflux/chainpad-netflux.js
99375570fec50b29692dafb8e1ada85e1a90ae29956ea939ba1d276514d8eac4  scrypt-async/scrypt-async.js
```

## 2. Container and persistent-data layout

### Mounted volumes

**Source-verified and live-verified.** The package manifest mounts exactly six
persistent StartOS data volumes, and its backup/restore procedure includes all
six. All are bind-mounted read/write for the normal service, although this
investigation only read them:

| StartOS volume | Live host path | Container mount | Purpose |
|---|---|---|---|
| `main` | `/embassy-data/package-data/volumes/cryptpad/data/main` | `/cryptpad/main` | StartOS-generated service config, including Tor/LAN names and optional administrator settings |
| `blob` | `/embassy-data/package-data/volumes/cryptpad/data/blob` | `/cryptpad/blob` | encrypted completed uploads and upload ownership proofs |
| `block` | `/embassy-data/package-data/volumes/cryptpad/data/block` | `/cryptpad/block` | encrypted account login blocks |
| `customize` | `/embassy-data/package-data/volumes/cryptpad/data/customize` | `/cryptpad/customize` | generated HTML and any administrator client-side overrides, especially `application_config.js` |
| `data` | `/embassy-data/package-data/volumes/cryptpad/data/data` | `/cryptpad/data` | archives, pins, incomplete uploads, tasks, decrees, and logs |
| `datastore` | `/embassy-data/package-data/volumes/cryptpad/data/datastore` | `/cryptpad/datastore` | encrypted ChainPad histories and channel metadata |

There is no separate `accounts` database in this version. A registered account
is represented by a credential-addressed login block, an encrypted drive
channel in the datastore, account pin logs, and any other account-owned
channels/blobs.

### Paths selected by the package configuration

The wrapper's `config.example.js` sets:

```text
filePath         ./datastore/
archivePath      ./data/archive
pinPath          ./data/pins
taskPath         ./data/tasks
blockPath        ./block
blobPath         ./blob
blobStagingPath  ./data/blobstage
decreePath       ./data/decrees
logPath          ./data/logs
```

The working directory is `/cryptpad`. In 5.1.0, `lib/env.js` retains these as
relative paths; ordinary filesystem calls therefore resolve them under that
working directory. This differs from 5.2.1, which converts several paths to
absolute paths during environment initialization.

### On-disk structures

**Source-verified from path-construction code.** Empty instances of the archive,
pin, staging, task, and decree directory shapes were also observed live.

| Path | Contents and recovery relevance |
|---|---|
| `/cryptpad/block/KK/<safe-public-key>` | Raw binary login block. `KK` is the first two characters of the URL-safe account-block signing public key. Essential for normal modern-account login. |
| `/cryptpad/datastore/cc/<channel>.ndjson` | Newline-delimited encrypted ChainPad message history. `cc` is the first two hex characters; ordinary pad/drive channel IDs are 32 hex characters. Essential. |
| `/cryptpad/datastore/cc/<channel>.metadata.ndjson` | Public server metadata changes: channel, creation time, validation key, owners, allowed users, expiration/restriction fields. Useful for signature verification and ownership, but not a substitute for encrypted content. |
| `/cryptpad/datastore/cc/<channel>.ndjson.offset` | Rebuildable read/index optimization. Not content. |
| `/cryptpad/datastore/cc/<channel>.ndjson.temp` | Temporary rewrite artifact. Inspect if the primary file is absent or damaged. |
| `/cryptpad/blob/bb/<48-hex-blob-id>` | Completed encrypted uploaded-file body. Essential for uploaded files. |
| `/cryptpad/blob/KKK/<safe-account-key>/bb/<blob-id>` | Empty ownership-proof files, not uploaded content. |
| `/cryptpad/data/pins/KK/<safe-account-key>.ndjson` | Append-only `PIN`, `UNPIN`, and `RESET` operations over channel/blob IDs, with timestamps. Useful as an inventory/retention cross-check. The drive remains the authoritative logical hierarchy. |
| `/cryptpad/data/blobstage/KK/<safe-account-key>` | Incomplete upload staging data. It may salvage partial uploads but is not a completed blob. |
| `/cryptpad/data/tasks/<prefix>/<id>.ndjson` | Scheduled expiration tasks. Not needed for decryption. |
| `/cryptpad/data/decrees/decree.ndjson` | Instance administrative decrees. Not user content. |
| `/cryptpad/data/logs/` | Server logs. Not needed for decryption and should not be used to expose credentials. |
| `/cryptpad/data/archive/datastore/cc/<channel>.ndjson` | Archived channel history. Recovery must search here if the live history is gone. |
| `/cryptpad/data/archive/datastore/cc/<channel>.metadata.ndjson` | Archived channel metadata. |
| `/cryptpad/data/archive/block/KK/<safe-public-key>` | Archived login block, potentially relevant after a password change or account archival. |
| `/cryptpad/data/archive/pins/...` | Archived pin logs. |
| `/cryptpad/data/archive/blob/bb/<blob-id>` | Archived blob body. In 5.1.0 both inputs to `path.join(archivePath, blobPath)` are relative (`./data/archive` and `./blob`); the live empty archive directory confirms this root. |

Relevant source functions:

- `lib/storage/file.js`: `mkPath`, `mkArchivePath`, `mkMetadataPath`,
  `mkArchiveMetadataPath`.
- `lib/storage/block.js`: `Block.mkPath`, `Block.mkArchivePath`.
- `lib/storage/blob.js`: `makeBlobPath`, `makeProofPath`, `makeStagePath`,
  `prependArchive`.
- `lib/pins.js`: `createLineHandler`, `Pins.calculateFromLog`, `Pins.load`.
- `lib/storage/tasks.js`: task path construction.
- `lib/decrees.js`: `decree.ndjson` path.

The live volume inventory is unexpectedly empty of test-user ciphertext:

| Volume | Live contents on 2026-08-28 |
|---|---|
| `block` | only `placeholder.txt` (12 bytes) |
| `blob` | only `placeholder.txt` (12 bytes) |
| `customize` | no files |
| `datastore` | no files |
| `data` | two small log files; empty `archive/{datastore,pins,blob}`, `decrees`, `pins`, `blobstage`, and `tasks` directories |
| `main` | one StartOS `config.yaml` |

Consequently there is currently no account block, drive/document history, pin
log, or blob on this host to inspect or decrypt. This is not evidence that the
formats are optional; it means the stated test accounts/documents are not in
the currently mounted persistent data. A read-only search of the StartOS
package-data tree found no alternate CryptPad volume, and a targeted search of
the Podman overlay layers found no hidden files under CryptPad's `datastore`,
`block`, `blob`, `data`, or `customize` paths.

All six volumes together are designed to contain the per-user ciphertext and
relevant persistent client configuration independently of the running
container. The retained `.s9pk` archive and image preserve the exact code and
dependencies. No irreplaceable per-user ciphertext was found outside the
mounts, but that conclusion must eventually be checked on a populated instance.

One important qualification is `customize/application_config.js`: `server.js`
serves `/customize` first and falls back to `/customize.dist`. Therefore a
persistent override can alter `loginSalt`. The generated HTML in the same
volume is not cryptographic state, but an application config override is. No
live override exists on this server, so its effective `loginSalt` is the
upstream default empty string.

## 3. Account/login cryptography

### Source path

The browser-side call chain is:

```text
www/login/main.js
  Login.loginOrRegisterUI(username, password, false, ...)
    customize.dist/login.js: loginOrRegister(...)
      www/common/common-credential.js: deriveFromPassphrase(...)
      customize.dist/login.js: allocateBytes(...)
      www/common/outer/login-block.js: getBlockUrl/decrypt
      common-hash.js: getSecrets(...)
      chainpad-listmap: create(...)
```

The exact upstream files are available at the
[`291b6dc…` tree](https://github.com/cryptpad/cryptpad/tree/291b6dcce629e1cce07fec76390505f777884f47).

### Input normalization and encoding

**Source-verified.**

- Login reads the username with jQuery `.val()` and does **not** trim it.
- Registration first applies JavaScript `.trim()` to the username.
- Both paths then apply JavaScript `.toLowerCase()` in
  `customize.dist/login.js:loginOrRegister`.
- There is no Unicode normalization such as NFC/NFKC.
- The password is not trimmed, lowercased, or otherwise normalized.
- `scrypt-async` 1.2.0 converts JavaScript strings with its own
  `stringToUTF8Bytes`. It encodes each UTF-16 code unit into one, two, or three
  bytes and does not combine surrogate pairs. Reusing this exact routine is
  necessary for non-BMP characters.

Thus a username that was registered through the normal UI is effectively
`registrationInput.trim().toLowerCase()`. A later login with surrounding
spaces derives a different account because login itself does not trim.

### KDF

`www/common/common-credential.js:deriveFromPassphrase` calls:

```text
scrypt(
  password,
  lowercasedUsername + loginSalt,
  logN = 8,
  r = 1024,
  dkLen = 192,
  interruptStep = 200
)
```

For `scrypt-async` 1.2.0 this means:

- algorithm: scrypt using PBKDF2-HMAC-SHA-256 and Salsa20/8 internally;
- `N = 2^8 = 256`;
- `r = 1024`;
- `p = 1` (hard-coded by this library);
- output: 192 raw bytes;
- approximate main scrypt memory: `128 * N * r = 33,554,432` bytes;
- `interruptStep=200` only controls browser scheduling, not the derived bytes.

The salt is not random per account. It is the normalized username concatenated
with `AppConfig.loginSalt`. In upstream 5.1.0,
`www/common/application_config_internal.js` sets `loginSalt = ''`; an
administrator can override it in persistent
`/cryptpad/customize/application_config.js`. That file is absent on the live
server, so the exact effective salt there is `lowercasedUsername + ''`.

### Derived-byte allocation

`customize.dist/login.js:allocateBytes` consumes the 192 bytes in order:

| Byte range | Length | Use |
|---:|---:|---|
| `0..17` | 18 | legacy account-drive edit seed |
| `18..33` | 16 | legacy account-drive channel ID (hex-encoded to 32 chars) |
| `34..65` | 32 | NaCl box/X25519 secret seed; produces account Curve25519 key pair |
| `66..97` | 32 | Ed25519 seed; produces account signing key pair |
| `98..129` | 32 | Ed25519 seed for the login-block signing key pair |
| `130..161` | 32 | login-block symmetric key |
| `162..191` | 30 | unused in 5.1.0 |

The legacy account capability is deterministic:

```text
/1/edit/<base64(16-byte channel seed)>/<base64(18-byte edit seed)>/
```

`chainpad-crypto:createEditCryptor` hashes the 18-byte edit seed with NaCl
SHA-512, uses bytes `0..31` as an Ed25519 seed, and bytes `32..63` as the
32-byte XSalsa20-Poly1305 encryption key.

### Modern account-block lookup

`www/common/outer/login-block.js:Block.genkeys` splits KDF bytes `98..161` into:

- a 32-byte Ed25519 seed (`keys.sign`); and
- a 32-byte secretbox key (`keys.symmetric`).

The block filename is derived from the base64 Ed25519 public key after replacing
`/` with `-` (padding is retained):

```text
/cryptpad/block/<safePublicKey[0:2]>/<safePublicKey>
```

The browser URL is the same relative `/block/...` path. This is the precise
account lookup mechanism; it requires no account-name database.

### Account-block format and authenticated encryption

`login-block.js:Block.encrypt` serializes the plaintext JSON as UTF-8 and writes:

```text
byte 0       version byte (currently 0; decrypt ignores it)
bytes 1..24  random 24-byte nonce
remaining    NaCl secretbox(plaintext, nonce, 32-byte symmetric key)
```

TweetNaCl secretbox is XSalsa20-Poly1305. Its ciphertext includes a 16-byte
Poly1305 authenticator. There is no separate stored MAC.

The write RPC additionally supplies an Ed25519 detached signature over
`NaCl.hash(ciphertext)` (SHA-512). `lib/commands/block.js:validateLoginBlock`
checks that signature before writing. `lib/storage/block.js:Block.write` stores
only the raw decoded ciphertext, so the detached write-authorization signature
is not available later. Secretbox authentication still detects a wrong
password/key or corrupted block.

The decrypted modern block is JSON with at least:

```json
{
  "User_name": "normalized username",
  "User_hash": "/2/drive/edit/.../",
  "edPublic": "base64 account signing public key"
}
```

The block hash kept in browser local storage is a URL plus `#` plus the symmetric
key, but recovery does not need browser local storage because all block keys are
re-derived from the credentials.

### Modern and legacy login branches

`customize.dist/login.js:loginOrRegister` performs:

1. normalize and validate inputs;
2. derive 192 bytes and allocate keys;
3. derive the block URL and fetch it;
4. if present, authenticate/decrypt the block;
5. parse `User_hash` with `common-hash.js:getSecrets`;
6. load/replay that random drive channel with the resulting key;
7. if no block exists, attempt the deterministic legacy v1 drive derived from
   bytes `0..33`.

This legacy fallback matters for older accounts. A recovery implementation
must try the modern block first, then the exact legacy branch, and should also
report archived block candidates without mutating/restoring them.

## 4. CryptDrive/account metadata

### Address and encryption

For modern accounts, `User_hash` is a random v2 `drive` edit capability created
at registration. `loginOptionsFromBlock` calls `Hash.getSecrets('pad',
User_hash)`; despite the misleading literal `pad`, the generic non-file hash
parser handles drive hashes here.

`loadUserObject` creates a classic `chainpad-listmap` channel with:

- the derived 32-hex-character channel;
- `Crypto.createEncryptor(keys)`;
- the derived validation key;
- `owners: [edPublic]`;
- initial JSON object `{}`;
- `ChainPad.SmartJSONTransformer` through `chainpad-listmap`.

The account drive is therefore an encrypted append-only ChainPad history, not a
single encrypted JSON file. `chainpad-listmap` replays the history, obtains
`realtime.getUserDoc()`, parses it as JSON, and exposes the resulting object.

### Logical schema

`www/common/userObject.js` names these drive roots:

```text
root                 nested folder-name -> folder object or numeric item ID
trash                deleted-name -> [{ path, element }, ...]
template             array of numeric item IDs
sharedFolders        numeric ID -> shared-folder metadata
sharedFoldersTemp    maybe-deleted or password-transition shared folders
filesData            numeric item ID -> document/upload metadata
static               numeric ID -> static-link metadata
CryptPad_RECENTPADS   old pre-migration metadata array (possible on old drives)
```

Folder names, filenames, titles, hierarchy, timestamps, and document references
are plaintext only *inside* the decrypted drive JSON; on disk they are protected
by the drive channel encryption.

A typical `filesData[id]` can contain:

```text
title, filename, href, roHref, channel, ctime, atime,
owners, password, fileType, uploaded, expire, ...
```

The logical tree stores numeric IDs, while `filesData` supplies the capability
and metadata for each ID. Old drives can use hrefs directly and must go through
the migration-compatible interpretation in `userObject.js`.

### Secondary protection of edit links

The drive channel as a whole is already encrypted. In addition,
`userObject.js:createCryptor/getHref` supports encrypting an editable `href`
again when the containing user object is initialized with an `editKey`. For a
string key, `chainpad-crypto:createEncryptor/parseKey` base64-decodes it, hashes
it with SHA-512, and uses bytes `0..31` as an XSalsa20-Poly1305 key. The stored
form is `base64(random 24-byte nonce) + "|" + base64(secretbox(href))`.
`roHref` is retained as a fallback. The primary logged-in account drive is
initialized without this optional layer in the 5.1.0 outer-store path; shared
folder/team user objects can supply a secondary key and therefore use it.
Uploaded-file `/file/#...` links are never secondarily encrypted because they
are inherently read-only capabilities.

An enumerator must therefore use the same `getHref` behavior with the key of
the containing drive/shared folder rather than assume every `href` contains a
visible `#`.

### Shared, owned, trashed, and permanently deleted items

- Ownership is represented by the server channel metadata and often the drive
  item's `owners` list. Access to a document is capability-based; a drive can
  reference a document the account does not own.
- A document shared directly with the user is generally just another
  `filesData` reference. The same channel can be referenced by multiple drives.
- A shared folder is different: `sharedFolders[id]` contains a drive-type
  capability. `www/common/outer/sharedfolder.js:SF.load` parses its href,
  applies its optional per-folder password, and loads another encrypted
  listmap/ChainPad `{}` channel. Recovery must recurse into that separate drive.
- Trash entries retain `path` and `element`; an element can be an item ID or an
  entire nested folder object. They should be enumerated under an explicit
  recovery namespace rather than hidden.
- Emptying trash/permanent deletion removes logical references from the drive.
  The ciphertext may still be in the live store, in `data/archive`, or already
  purged. Pins and archived histories can help identify orphaned material, but
  without a surviving capability/key it cannot be decrypted.

## 5. Document capabilities, cryptography, and reconstruction

### Link/capability versions

`www/common/common-hash.js:parseTypeHash/getSecrets` supports several historical
formats. The relevant ones are:

- v1 pad edit: `/1/edit/<explicit-channel-b64>/<18-byte-edit-key-b64>/...`
- v1 pad view: `/1/view/<explicit-channel-b64>/<32-byte-view-key-b64>/...`
- v2 pad edit: `/2/<app>/edit/<18-byte-seed-safe-b64>/[p/]...`
- v2 pad view: `/2/<app>/view/<32-byte-view-seed-safe-b64>/[p/]...`
- v1/v2 file links, parsed separately as type `file`;
- v3 safe/hidden links contain a channel but intentionally do not carry the
  secret and are not independently recoverable without another key source.

The drive item may also contain a `password` field. That is a **document-level
password** and is incorporated into v2 key derivation. It is distinct from the
account login password. The account password merely unlocks the drive where
this field and the document capability are stored.

### v2 document key derivation

The exact installed `chainpad-crypto` 0.2.7 functions are
`createEditCryptor2` and `createViewCryptor2`. With `P` equal to the TweetNaCl
UTF-8 encoding of the optional document password and `S` the link seed:

```text
H1 = SHA-512((P if present) || S_edit)            # S_edit is 18 bytes
edit signing seed = H1[0:32]                     # Ed25519
view seed = H1[32:64]                            # encoded into view link

H2 = SHA-512((P if present) || view_seed)
channel bytes = H2[0:16]                         # 16 bytes -> 32 hex chars
secretbox key = H2[16:48]                        # 32 bytes
secondary signing seed = H2[32:64]               # Ed25519, for special uses
```

An edit capability also yields the Ed25519 signing and validation keys. A view
capability yields the channel and symmetric decryption key but not the primary
edit signing key.

v1 links carry the channel explicitly. For a v1 edit key,
`createEditCryptor` computes SHA-512 over the decoded 18-byte key, uses the first
32 bytes as an Ed25519 seed and the last 32 bytes as the secretbox key. A v1
view key directly supplies the 32-byte symmetric key.

### Channel history storage and framing

For a 32-hex channel `C`, content is in:

```text
/cryptpad/datastore/C[0:2]/C.ndjson
```

Each stored content line is a JSON Netflux message array. In the 5.1.0 history
path, index `3` is the channel ID, index `4` is the encrypted ChainPad message,
and the history keeper appends a millisecond timestamp at index `5`. Historical
logs may also contain metadata-style lines; the separate
`.metadata.ndjson` file is authoritative for current metadata. A parser must
match the original tolerant behavior rather than assume every line is content.

`chainpad-crypto:createEncryptor` encodes each ordinary pad/drive message as:

```text
inner = base64(random 24-byte nonce) + "|" +
        base64(secretbox(UTF8(chainpadMessage), nonce, 32-byte channel key))

stored encrypted message =
        base64(Ed25519_attached_signature(UTF8(inner), document signing key))
```

Thus:

- symmetric primitive: XSalsa20-Poly1305 secretbox;
- symmetric key: 32 bytes;
- nonce: independent random 24 bytes per message, encoded alongside ciphertext;
- symmetric authentication: 16-byte Poly1305 tag in each secretbox;
- writer authentication: 64-byte attached Ed25519 signature outside the inner
  secretbox string.

The server validates signed messages against the channel's public validation
key before appending. The browser history path skips repeating that expensive
signature verification and removes the first 64 decoded bytes because it trusts
the history keeper. An offline recovery utility should verify signatures when a
validation key is available, then verify every secretbox tag.

Checkpoints are prefixed outside the signed message:

```text
cp|[base64(first 8 bytes of SHA-512(plaintext checkpoint))|]<signed ciphertext>
```

After removing this prefix and decrypting, `chainpad-netflux` removes a legacy
bencoded numeric prefix if present and calls `realtime.message(plaintext)`.
ChainPad checkpoint messages begin with `[4`.

### Reconstruction requirement

**Source-verified.** Documents do not normally exist as one encrypted final
file. The plaintext messages are ChainPad operational-transform patches and
checkpoints. Recovery requires feeding the authenticated, decrypted messages to
the exact ChainPad engine in history order and then reading
`realtime.getUserDoc()`.

`chainpad-netflux` is tolerant of a truncated history beginning at a valid
checkpoint, adopts that checkpoint as its root, handles branches, and chooses
the best chain. Reimplementing these rules would be risky. The proof of concept
should load the original `chainpad` JavaScript and call the same `message`
method. For account drives/shared folders it must also use the JSON initial
state and SmartJSON behavior from `chainpad-listmap`.

The final reconstructed application document is generally a JSON string, but
its `content` schema is application-specific. Decryption alone therefore proves
raw state recovery (level A), not necessarily a polished export.

## 6. Uploaded files/blobs

### Capability and storage ID

For v2 files, `chainpad-crypto:createFileCryptor2` computes:

```text
H = SHA-512((documentPasswordUTF8 if present) || 18-byte file seed)
blob ID bytes = H[0:24]       # 24 bytes -> 48 hex characters
file key = H[24:56]           # 32 bytes
```

The encrypted body is `/cryptpad/blob/<first-two-hex>/<48-hex-id>`.

For v1 files the link contains an explicit channel/blob ID and a direct
base64-decoded symmetric file key; `common-hash.js:getSecrets` handles this
branch.

### Blob framing

`www/file/file-crypto.js` defines:

```text
2-byte big-endian metadata-box length
secretbox(JSON metadata, nonce 0, file key)
secretbox(plaintext bytes 0..131071, nonce 1, file key)
secretbox(next 128 KiB, nonce 2, file key)
...
```

- plaintext content chunk size: 128 KiB (131,072 bytes);
- full ciphertext chunk size: 131,088 bytes (plaintext plus 16-byte tag);
- initial nonce: 24 zero bytes;
- nonce increment: big-endian-style counter over bytes 1 through 23 (byte 0 is
  left unchanged by the historical loop);
- metadata: UTF-8 JSON, commonly filename/name, MIME type, and possibly a
  thumbnail;
- primitive/authentication: XSalsa20-Poly1305 with a 32-byte key and 16-byte tag
  per record.

Concatenating the authenticated plaintext content chunks reproduces the
original upload bytes. This makes byte-for-byte recovery practical; Phase 5
must still prove it by comparing a known original hash.

Ownership-proof files underneath the three-character account-key directory are
not blob bodies and must not be offered as user files. Incomplete staging files
also require separate labeling.

## 7. Application-specific recovery and export feasibility

CryptPad 5.1.0 advertises drive, teams, sheet, doc, presentation, pad, kanban,
code, form, poll, whiteboard, file, contacts, slide, and convert; hidden/internal
types also include todo and calendar. Only items referenced by the recovered
drive are in scope for ordinary document recovery.

The existing `www/common/make-backup.js` is important prior art: the browser's
own full-drive export reconstructs a pad and dynamically loads
`/<type>/export.js`, while files use `file-crypto.js`. Reusing these exact
exporters is safer than inventing formats, though several assume a browser DOM.

| Type | Raw decrypted state | Practical recovery target | Important limits |
|---|---|---|---|
| Uploaded file | encrypted blob records | original binary, byte-for-byte (D) | strongest fidelity; verify hash |
| Code/text | JSON with `content` text and highlighting metadata | plain text with inferred extension (B/E) | straightforward after ChainPad replay |
| Slide | JSON with Markdown-like `content` | Markdown `.md` (B/E) | presentation styling may rely on metadata/assets |
| Rich text (`pad`) | HyperJSON document array | HTML default; Markdown; HTML packaged as `.doc` (B/C/E) | exporter needs DOM, HyperJSON, Turndown; embedded media must also be recovered |
| Kanban | structured JSON | formatted JSON (A/F) | no native interchange exporter in this version |
| Poll | structured JSON | CSV, with JSON fallback (E/F) | preserve raw JSON for edge cases |
| Form | form-definition JSON; answers use additional message/channel logic | definition JSON; results CSV if answer channels can be recovered (A/E/F) | the 5.1.0 results exporter supports CSV, not the JSON results option added later; the drive backup exporter deliberately removes `answers` |
| Calendar | structured event JSON | iCalendar `.ics` (E) | 5.1.0's exporter predates later recurrence-handling improvements; preserve raw state too |
| Whiteboard | Fabric.js canvas JSON | raw JSON reliably; PNG with browser/canvas runtime (A/E/F) | headless PNG fidelity requires Fabric, fonts, images, and canvas behavior |
| Sheet | OnlyOffice/CryptPad structured state | raw state first; `.xlsx` potentially (A/E) | native export uses bundled OnlyOffice/x2t browser/WASM machinery |
| Document (`doc`) | OnlyOffice/CryptPad structured state | raw state first; `.docx` potentially (A/E) | same conversion complexity |
| Presentation | OnlyOffice/CryptPad structured state | raw state first; `.pptx` potentially (A/E) | same conversion complexity |
| Todo/other type without exporter | application JSON | raw JSON (A/F) | application-specific interpretation later |

The standalone utility should always be able to preserve authenticated raw
decrypted state even when a native exporter cannot run. Native Office and
rendered whiteboard exports must not be promised until their exact 5.1.0 assets
work in the constrained target environment.

## 8. Feasibility conclusion and implementation direction

The source demonstrates the desired legitimate path:

```text
username + account password
  -> historical scrypt derivation
  -> deterministic account-block filename and symmetric key
  -> authenticated account block
  -> random CryptDrive capability
  -> authenticated/decrypted/replayed drive history
  -> document/blob capabilities and optional per-item passwords
  -> authenticated/decrypted/replayed document histories or blob records
  -> raw application state, useful export, or original upload bytes
```

Nothing in that chain treats the username/password as a document key. The only
apparent fundamental failure cases are missing/corrupt source data, a missing
custom `loginSalt`, a missing account block plus no usable legacy drive, a
missing per-document password/capability, or data already purged from both live
and archive storage.

The safest implementation direction is JavaScript/Node and reuse of the exact
5.1.0 client modules (`scrypt-async`, TweetNaCl, `common-hash`,
`chainpad-crypto`, ChainPad/listmap logic, and file crypto). This is provisional
only in the sense that deployment packaging has not been tested. Rewriting the
KDF, old string encoding, hash parsing, signature framing, or ChainPad replay
in another language would add avoidable compatibility risk.

The live Alpine container has Node 16.19.0, npm 8.19.3, bash, curl, tini, yq,
and the installed CryptPad dependencies; it does not have the nginx layer used
by the later package. The StartOS host has Podman but no `node` executable in
its normal path. A later standalone design can either bundle a compatible
runtime or arrange a strictly read-only execution environment that reuses the
image. It must not depend on network access or an external CryptPad service.

## 9. Live-server reconnaissance results and remaining gap

The following were established read-only over SSH:

- host `cryptpad-test` is x86_64 StartOS 0.3.5.1, with persistent package data
  mounted at `/embassy-data/package-data`;
- Podman runs container `cryptpad.embassy` from the exact 5.1.0 image recorded
  above;
- all six bind sources and container destinations match the package manifest;
- live application/source hashes match upstream 5.1.0 and the exact resolved
  dependency versions;
- the effective custom application config is absent and `loginSalt` is empty;
- the package archive remains present independently of the running container;
- the volume inventory contains placeholders, logs, configuration, and empty
  directory scaffolding, but no encrypted test account or document data; and
- neither an alternate CryptPad volume nor unmounted user data hidden in the
  Podman overlay layers was found.

No service was restarted or stopped, no container command wrote data, and no
remote file was created, changed, or deleted. The remaining Phase 1 empirical
gap is inspection of representative account blocks, histories, metadata, pins,
and blobs on a populated test instance. Phase 2 additionally requires known
test credentials through an interactive password prompt, never a command-line
argument.

## 10. Original validation gates for later phases

At the end of Phase 1, the following claims were not yet empirical results.
Section 12 records that the Phase 2–5 gates have since passed for the fixtures;
shared folders, trash, historical variants, and broader exporters remain open:

- that the known test credentials derive the live account block;
- that its secretbox authenticates and `User_hash` loads the test drive;
- that offline ChainPad replay produces the same drive tree as the UI;
- that a known simple document reconstructs to expected content;
- that a known uploaded file decrypts to the original hash;
- that shared folders, trash, old hashes, archived histories, and app exporters
  behave as predicted against actual package data.

Phase 2 should prove only the first drive decryption, with a secure password
prompt and read-only local access. Phase 3 should enumerate. Phase 4 should
replay one simple document. Phase 5 should compare an uploaded file hash. The
user-facing standalone utility should wait until those gates pass.

## 11. Primary source index

Historical StartOS wrapper package tag at commit `8845b71…`:

- `manifest.yaml` — version, mounts, backup/restore, interfaces.
- `Dockerfile` — Node 16 build/runtime and dependency installation.
- `docker_entrypoint.sh` — generated config, origins, and startup.
- `config.example.js` — storage paths.
- `.gitmodules` and `cryptpad-docker` gitlink — exact Docker helper provenance.

CryptPad at commit `291b6dc…` (tag 5.1.0):

- `www/login/main.js`, `www/register/main.js` — UI input handling.
- `customize.dist/login.js` — login flow and derived-byte allocation.
- `www/common/common-credential.js` — scrypt invocation and login salt.
- `www/common/application_config_internal.js` — default `loginSalt` and app list.
- `www/common/outer/login-block.js` — block keys, path, encryption, signature.
- `lib/commands/block.js`, `lib/storage/block.js` — server validation and block storage.
- `www/common/common-hash.js` — capability parsing and v1/v2 secret derivation.
- `www/common/cryptget.js` — normal document loading path.
- `www/common/userObject.js`, `www/common/outer/userObject.js` — drive schema and edit-link handling.
- `www/common/outer/sharedfolder.js` — shared-folder drive loading.
- `lib/hk-util.js`, `lib/storage/file.js` — history framing, validation, timestamps, and paths.
- `lib/storage/blob.js`, `www/file/file-crypto.js` — blob paths and record crypto.
- `lib/pins.js`, `lib/storage/tasks.js`, `lib/decrees.js` — auxiliary persistence.
- `www/common/make-backup.js`, `www/*/export.js` — existing export behavior.

Build-resolved dependency sources verified against the live image:

- `scrypt-async` 1.2.0: `scrypt-async.js`.
- `chainpad-crypto` 0.2.7 (`c8b76b8…`): `crypto.js`.
- `chainpad-netflux` 1.0.0 (`66ef76…`): `chainpad-netflux.js`.
- `chainpad-listmap` 1.0.1 (`1ed90ed…`): `chainpad-listmap.js`.
- `chainpad` 5.2.4 (`a7b1eff…`): `chainpad.dist.js`.
- `tweetnacl` 0.12.2: `nacl-fast.js`/`nacl-fast.min.js`.

## 12. Phase 2–5 empirical results

Validation date: 2026-08-29. These results supersede the earlier Phase 1 note
that the live test volumes were empty.

### Phase 2: account and CryptDrive recovery — passed

Using only the read-only encrypted snapshot, username, and interactively
supplied password, `src/recovery.js` reused the historical scrypt implementation
to derive 192 bytes. Bytes 98–161 located and authenticated the 194-byte account
block. Its decrypted JSON identified user `recovery-fixture-20260828` and the
random v2 drive capability.

The derived drive channel was
`ddab0eb00ef95debe7de77440fe425d0`. The exact ChainPad engine authenticated,
decrypted, and replayed 16 drive messages in the Phase 4 snapshot and 18 in the
Phase 5 snapshot. The result was valid account/CryptDrive JSON.

### Phase 3: logical drive enumeration — passed

Enumeration followed the decrypted `drive.root` references into `filesData`;
it did not infer files from datastore filenames. The Phase 4 snapshot produced
exactly the three expected Code entries. The Phase 5 snapshot additionally
produced the uploaded binary entry and its 48-hex blob ID.

This distinction was empirically useful: aborted UI experiments left encrypted
but unreferenced pad channels in the datastore. They are correctly absent from
the logical drive inventory.

### Phase 4: Code document recovery — passed

For each Code capability, the implementation derived the channel/signing/
secretbox keys, verified every Ed25519-attached message, authenticated every
secretbox, replayed the plaintext ChainPad operations, parsed the resulting app
state, and exported its `content` string. Fresh CLI outputs matched all expected
files byte-for-byte:

| Title | Bytes | SHA-256 |
|---|---:|---|
| `recovery-canary-short.txt` | 90 | `5179c90e098f1c334da35d9048ad1b2a042477ee0ceffee5e946873a66ad3c9c` |
| `recovery-canary-unicode.md` | 147 | `6dc7d23b24ce9576b4cfdfc3c1a5e868f629254b2e3fadb85063b6ff86d69b87` |
| `recovery-canary-long.txt` | 2790 | `270ffd3e0770b44bbdb07320c509f5ac08e123b0b72677c241133ac4d6f43202` |

### Phase 5: uploaded binary recovery — passed

The 300,123-byte fixture was uploaded through the normal 5.1.0 browser client
as an owned file. Its decrypted drive entry yielded blob ID
`47fa80fe5b7b6d8f4964061efddc45cfb5be91b7e4635e19`. Offline recovery
authenticated and decoded metadata naming `recovery-canary-binary.bin` with
MIME type `application/octet-stream`, then authenticated and concatenated three
file chunks. The recovered bytes matched the original exactly:

```text
9a9845aa18e177d426c70a13cd0535de112d4a4f69dbfd949aef1b59f46a28b6
```

The recovery core is `src/recovery.js`; regression coverage is in
`test/recovery.test.js`; reproducible usage and current limitations are in
`README.md`.

## 13. Phase 7 standalone SSH utility

Validation date: 2026-08-29. The selected deployment is a self-contained SSH
bundle, not an `.s9pk` and not a StartOS service.

### Packaging and runtime — passed

`scripts/build-release.sh` downloads the official Node.js 16.19.0 Linux x64
archive, verifies it against Node's `SHASUMS256.txt`, and packages its runtime
with the recovery code and exact vendored CryptPad dependencies. The verified
Node archive SHA-256 is:

```text
c88b52497ab38a3ddf526e5b46a41270320409109c3f74171b241132984fd08f
```

The generated release archive contains an internal per-file manifest. Its
launcher verifies that manifest before starting recovery. GitHub tag pushes are
configured to build and publish the archive and its external SHA-256 checksum.

### Target-host execution — passed

The generated 0.2.0 bundle was copied to a temporary directory on
`cryptpad-test`, externally checksum-verified, extracted, and run as the normal
`start9` SSH user. It used its bundled Node 16.19.0 executable and the default
read-only CryptPad volume path; no system Node installation, CryptPad container,
network access, or service/package change was required.

The interactive username/password prompts recovered all four Phase 4–5 items.
The generated archive was copied back over `scp`, its archive checksum passed,
and each extracted file retained its expected byte-for-byte SHA-256. Source
data was not modified.

### Diagnostic log privacy — passed

Every run creates a mode-0600 JSON Lines support log separate from the recovered
file archive. It records build/runtime/StartOS identity, storage probes, stages,
timings, type/count/size summaries, verified message/chunk counts, anonymized
per-item outcomes, stable error codes, and sanitized stack traces.

Automated fixture tests and a post-run target-host scan verified that the log
contains no password, username, user filename, fixture content, absolute data or
output path, channel/blob/block identifier, capability, or key. The recovered
file archive is explicitly excluded from support requests.

The GitHub repository and v0.2.0 release were subsequently published;
target-host acceptance of that bundle passed.

## 14. Phase 6 broader application recovery

Validation date: 2026-08-29. Real Pad, Slide, Kanban, and Sheet fixtures were
created with the CryptPad 5.1.0 browser client and captured as an encrypted,
read-only regression snapshot.

The application replay transformer must match the historical framework:
Pad and Whiteboard use ChainPad's NaiveJSON transformer; the ordinary app
framework uses SmartJSON; Poll and Calendar additionally start from an explicit
empty object. Starting Pad from `{}` was empirically incorrect, while starting
from the empty string reconstructed its HyperJSON state exactly.

Phase 6 adds useful adapters for Code text, Pad safe HTML, Slide Markdown,
Kanban JSON, Poll CSV, and Whiteboard Fabric JSON. Every app also retains its
complete replayed state in a `.cryptpad.json` sidecar, so an imperfect
presentation adapter does not discard authenticated data.

OnlyOffice-backed Sheet, Document, and Presentation use two histories. The
primary ChainPad state holds metadata plus a random secondary channel. That
secondary channel is encrypted with the primary document secret and contains
authenticated `saveChanges` JSON messages whose `change` fields are opaque
OnlyOffice binary patches. The recovery utility now verifies every secondary
message and preserves its plaintext exactly in
`.onlyoffice-history.json`. Native Office rendering still requires a compatible
OnlyOffice conversion/replay runtime and is not claimed by this phase.

Regression coverage proves exact rich-text HTML and Slide Markdown, semantic
Kanban content, and authenticated preservation of a real Sheet secondary edit
history. Live UI fixtures for Poll, Whiteboard, Form, Calendar, Document, and
Presentation remain future coverage work even though their replay/raw export
paths are implemented from the verified 5.1.0 source behavior.

## 15. v0.3.0 target-host acceptance and the duplicate-title defect

Validation date: 2026-08-29. The v0.3.0 release archive was run against a real
account's live data on a StartOS 0.3.5.1 test server (`shoddy-cradles`). Of 5
drive items, 4 recovered; item 2, a Pad, failed with `OUTPUT_ALREADY_EXISTS`.

Cause: `enumerateDrive` derived each item's recovery output path from its
CryptPad title alone. CryptPad does not enforce title uniqueness within a
drive folder, so the account held two items with an identical title. The
second item to be written collided with the first item's already-written
output file.

Fix: `enumerateDrive` now groups items by their computed path after the drive
and trash walks and, for every group with more than one member, appends
` (<element id>)` to every member but the lowest-id one. The element id is
CryptPad's own stable per-item drive slot number, so the disambiguated path is
deterministic across repeated recovery runs of the same account snapshot.
Covered by a synthetic-drive unit test; the live Phase 6 fixture set has no
duplicate titles to exercise this against, so it is not covered by an
encrypted fixture.

Re-verification: the v0.3.1 release archive was run against the same account
on the same test server. All 5 drive items recovered, including both
same-titled Pads, with 0 failed and 0 skipped.

## 16. StartOS 0.4.0 relocates the CryptPad data volume

Validation date: 2026-08-29. The real end user this tool is for had already
upgraded their server past 0.3.5.1 by the time recovery was needed, so
`shoddy-cradles` was upgraded from StartOS 0.3.5.1 to 0.4.0.1 to match.

Confirmed by SSH onto the upgraded host and inspecting its filesystem
directly (not from documentation or memory): `/embassy-data` no longer
exists under 0.4.0.1. `start-cli package list` still reports the installed
`cryptpad` package at `5.1.0:0`, and `sudo find / -iname package-data`
located its persistent volumes under a new mount point:

```text
/media/startos/data/package-data/volumes/cryptpad/data
```

The CryptPad-internal layout under that root is unchanged from 0.3.5.1 —
`block/`, `datastore/`, `blob/`, `datastore` fan-out by two-character hex
prefix, `.version` reading `5.1.0:0` — only the StartOS-side mount point
moved. The directory tree is owned `root:root` but world-readable (`o+rx`),
so the unprivileged `start9` SSH user (which is what the recovery utility
runs as) can read it without `sudo`, matching the same access model as the
old `/embassy-data` path.

Fix: `resolveDefaultDataRoot` (`src/recovery.js`) now holds an ordered list
of known StartOS data-volume paths, newest first, and returns the first one
whose `block`/`datastore`/`blob` subdirectories actually exist on disk. The
CLI only falls back to a hardcoded default when no candidate is present, and
records which one (if any) was auto-selected in the support log as
`dataRootDefaultLabel` for diagnosability. `--data` still overrides
auto-detection entirely and skips the probe.

Re-verification: the v0.3.2 release archive was run with no `--data` flag
against the same real account on the same test server, now upgraded to
StartOS 0.4.0.1. All 5 drive items recovered with 0 failed and 0 skipped —
the same result as the v0.3.1 run on 0.3.5.1 — confirming auto-detection
found the relocated volume and the StartOS upgrade itself did not otherwise
change anything CryptPad-recovery-relevant.
