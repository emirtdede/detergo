# Code Signing Policy & Package Manager Distribution

## 1. Microsoft Store (MSIX) Distribution

Detergo is registered in Microsoft Partner Center for native MSIX Store distribution. Microsoft signs Store-published `.msix` packages directly during Store certification, eliminating SmartScreen warnings on Windows Store installs.

- **App Name**: `Detergo`
- **Package/Identity/Name**: `Vellium.Detergo`
- **Package/Identity/Publisher**: `CN=1DDB196A-421B-4090-8DC2-62C1AD43C8F0`
- **Package/Properties/PublisherDisplayName**: `Vellium`
- **Package Family Name (PFN)**: `Vellium.Detergo_3ktyfn38rr7qr`
- **Package SID**: `S-1-15-2-2854078406-4063938796-3595095355-3205781903-1229320626-3530847878-1123561423`
- **Store ID**: `9MWNT98V0905`
- **Store Deep Link**: `ms-windows-store://pdp/?productid=9MWNT98V0905`
- **Local Manifest**: [`packaging/msix/AppxManifest.xml`](../packaging/msix/AppxManifest.xml)
- **Submission Status**: **Held locally (Draft)**. Do not submit or commit a Microsoft Store release until explicit maintainer approval.

When running as an MSIX Store package (`InstallChannel::MsixStore`), Detergo automatically disables external `.exe` downloads and directs the user to Microsoft Store (`ms-windows-store://pdp/?productid=9MWNT98V0905`) to stay 100% compliant with Microsoft Store Policies.

---

## 2. Code Signing Policy (SignPath Foundation for GitHub Releases)

Free Authenticode code signing for GitHub Releases is planned via [SignPath.io](https://signpath.io/), using a certificate issued by the [SignPath Foundation](https://signpath.org/) (tracked in [`docs/FUTURE_ROADMAP.md`](./FUTURE_ROADMAP.md)).

### Signing Scope & Trust Guarantees

- **Build Origin**: Release binaries are built exclusively on GitHub-hosted `windows-latest` runners via the public workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) triggered by annotated release tags (`refs/tags/v*`).
- **Signed Artifacts**:
  - `Detergo-<version>-x64-Setup.exe` (NSIS installer)
  - `Detergo-<version>-x64.msi` (WiX MSI installer)
  - `Detergo-<version>-Portable.exe` (standalone portable GUI executable)
  - `detergo.com` (Windows console-subsystem CLI companion)
- **Private Key Isolation**: Signing keys reside exclusively inside SignPath's Hardware Security Module (HSM) and are never accessible to GitHub Actions runners or maintainers.
- **Provenance & Verification**: Every release publishes `SHA256SUMS.txt`, `BUILD_INFO.json`, and `latest-release.json` computed over the final (signed) release binaries, binding them to the exact Git commit.

### Team Roles

- **Committers & Reviewers**: Project maintainers with GitHub 2FA/MFA enforced on [`emirtdede/detergo`](https://github.com/emirtdede/detergo).
- **Approvers**: Designated SignPath Foundation approvers (with SignPath 2FA/MFA enabled) who authorize release signing requests for tagged releases.

### Privacy Policy Statement

Detergo is strictly **local-first** and **open-source (MIT)**. It requires no user account, collects no telemetry, crash reports, analytics, or personal data, and makes no background network requests. The full Privacy Policy ships offline inside the application (**About -> Legal -> Privacy Policy**).

### How to Activate SignPath Foundation Signing

1. **Prerequisites**:
   - Ensure [`emirtdede/detergo`](https://github.com/emirtdede/detergo) is **public** on GitHub with the MIT [`LICENSE`](../LICENSE), at least one public release, and GitHub 2FA enabled for all maintainers.
   - Ensure the Code Signing Policy above is publicly accessible (linked from [`README.md`](../README.md)).
2. **Apply**:
   - Submit the open-source application at [https://signpath.org/open-source](https://signpath.org/open-source) with:
     - Repository URL: `https://github.com/emirtdede/detergo`
     - Code Signing Policy URL: `https://github.com/emirtdede/detergo/blob/main/docs/SIGNING_AND_DISTRIBUTION.md#2-code-signing-policy-signpath-foundation-for-github-releases`
     - License: MIT (OSI-approved, no commercial dual-licensing, no proprietary blobs)
3. **Configure SignPath Dashboard** (once approved):
   - Create Project slug: `detergo`
   - Create Artifact Configuration accepting a `<zip-file>` (matching `actions/upload-artifact@v4`) signing `*.exe`, `*.msi`, and `*.com` inside the archive.
   - Create Signing Policy slug: `release-signing` restricted strictly to GitHub Actions builds from `emirtdede/detergo` on `refs/tags/v*` using workflow `.github/workflows/ci.yml`.
   - Generate a CI API token for the submitter account.
4. **Configure GitHub Repository Secrets & Variables** (`Settings -> Secrets and variables -> Actions`):
   - **Secret**: `SIGNPATH_API_TOKEN`
   - **Variable** (or Secret): `SIGNPATH_ORGANIZATION_ID`
   - Optional Variables (defaults already set in `.github/workflows/ci.yml`):
     - `SIGNPATH_PROJECT_SLUG` (default: `detergo`)
     - `SIGNPATH_SIGNING_POLICY_SLUG` (default: `release-signing`)
5. **Release**:
   - Push a tag (`git tag -a v1.0.0 -m "v1.0.0" && git push origin v1.0.0`).
   - `.github/workflows/ci.yml` automatically builds unsigned artifacts, uploads them for SignPath verification, submits the signing request via `signpath/github-action-submit-signing-request@v3`, replaces `release_output/` binaries with the signed ones, recomputes `SHA256SUMS.txt`, `BUILD_INFO.json`, and `latest-release.json`, and publishes the signed GitHub Release.

---

## 3. Windows Package Manager (WinGet)

Ready-to-submit WinGet 1.9 manifests live in [`packaging/winget/`](../packaging/winget/):

- [`Vellium.Detergo.yaml`](../packaging/winget/Vellium.Detergo.yaml) (version manifest)
- [`Vellium.Detergo.installer.yaml`](../packaging/winget/Vellium.Detergo.installer.yaml) (NSIS + WiX MSI installer metadata with `UpgradeCode`)
- [`Vellium.Detergo.locale.en-US.yaml`](../packaging/winget/Vellium.Detergo.locale.en-US.yaml) (English catalog metadata)

### Submitting a Release to `microsoft/winget-pkgs`

1. Publish the tagged GitHub Release (`v<version>`) containing `Detergo-<version>-x64-Setup.exe`, `Detergo-<version>-x64.msi`, and `SHA256SUMS.txt`.
2. Update `InstallerSha256` in `packaging/winget/Vellium.Detergo.installer.yaml` from the final `SHA256SUMS.txt` (or use `wingetcreate update Vellium.Detergo --version <version> --urls ... --submit`).
3. Validate locally before opening the PR:
   ```powershell
   winget validate --manifest packaging/winget
   ```

---

## 4. Scoop Bucket Manifest

A ready-to-submit Scoop manifest lives in [`packaging/scoop/detergo.json`](../packaging/scoop/detergo.json). It installs both the portable GUI executable (`detergo.exe`) and the synchronous console companion (`detergo.com`), and includes `checkver` + `autoupdate` rules tied to GitHub Releases and `SHA256SUMS.txt`.

### Testing Locally with Scoop

```powershell
scoop install packaging/scoop/detergo.json
detergo --version
```
