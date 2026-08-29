# Publishing a standalone release

The public release target is `JesseMarkowitz/cryptpad-recovery`. Publishing is
done from a clean committed worktree; generated `dist/` files are intentionally
not committed.

1. Run the complete fixture regression with the test password supplied only
   through the environment as documented in `README.md`.
2. Confirm `git diff --check` passes and the worktree is clean.
3. Build locally with `scripts/build-release.sh` and exercise the generated
   archive on the StartOS test host.
4. Push `main`.
5. Create and push an annotated version tag matching `package.json`, for
   example `v0.3.2`.
6. The `.github/workflows/release.yml` tag workflow builds the clean commit,
   downloads and checksum-verifies Node 16.19.0 from nodejs.org, and publishes
   the release archive plus its checksum.
7. Download the published assets using the exact commands in `STANDALONE.md`,
   verify the checksum, and run one final StartOS acceptance test.

Do not upload a locally dirty build. `BUILD_INFO.json` in every bundle records
the source commit, dirty flag, bundled runtime version, and verified upstream
runtime-archive hash.
