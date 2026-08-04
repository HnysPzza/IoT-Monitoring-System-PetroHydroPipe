# UI Orchestrator Installation Contract

## Release

- Release ID: `ui-orchestrator-2026-08-04-final-fix-1`
- Release root: `.agents/skills/petro-ui-orchestrator/assets/ui-orchestrator/`
- Install target: `$env:USERPROFILE\.codex\skills\ui-orchestrator\`
- Hash algorithm: `SHA-256`

The release root is a distribution snapshot, not an active workflow. The installed global package remains the workflow source of truth after its integrity is verified.

## File Manifest

| Relative path | SHA-256 |
|---|---|
| `SKILL.md` | `db7d26c04e23186235abfe999dfe3083fe372e75115aa85fe281491043fd1f9b` |
| `agents/openai.yaml` | `726e9354e5ca6dbd86e9397ab6781895a9b165cd6e6ebf5a3f505241d60bec4d` |
| `references/dependency-contract.md` | `089dd1e2ca6ba806eb65aa13ab662be36ff82869efb437802a5a57fd4b31013e` |
| `references/report-templates.md` | `6d4ba86f146b328712a6183e05ac3022c0face8d58a28b8eabdb27cfc1f7df17` |
| `references/review-protocol.md` | `722df2b072f2925e40d25f4ff401f93a84b7334709912cb5af3e0325503e1f8a` |

## Manual Install

Never copy or overwrite this package automatically. If the installed package is absent or mismatched, pause and obtain explicit human authorization. The human must inspect or preserve any existing target before choosing to install.

After authorization, and only when the human has confirmed the target handling, run from the repository root:

```powershell
$releaseRoot = Resolve-Path '.agents\skills\petro-ui-orchestrator\assets\ui-orchestrator'
$targetParent = Join-Path $env:USERPROFILE '.codex\skills'
$targetRoot = Join-Path $targetParent 'ui-orchestrator'

Test-Path -LiteralPath $targetRoot
# Stop for a human decision if this returns True and any file is mismatched.
New-Item -ItemType Directory -Force -Path $targetParent
Copy-Item -LiteralPath $releaseRoot -Destination $targetParent -Recurse
```

## Verify

Run this verification against both the release snapshot and installed target:

```powershell
$expected = [ordered]@{
  'SKILL.md' = 'db7d26c04e23186235abfe999dfe3083fe372e75115aa85fe281491043fd1f9b'
  'agents\openai.yaml' = '726e9354e5ca6dbd86e9397ab6781895a9b165cd6e6ebf5a3f505241d60bec4d'
  'references\dependency-contract.md' = '089dd1e2ca6ba806eb65aa13ab662be36ff82869efb437802a5a57fd4b31013e'
  'references\report-templates.md' = '6d4ba86f146b328712a6183e05ac3022c0face8d58a28b8eabdb27cfc1f7df17'
  'references\review-protocol.md' = '722df2b072f2925e40d25f4ff401f93a84b7334709912cb5af3e0325503e1f8a'
}
$releaseRoot = Resolve-Path '.agents\skills\petro-ui-orchestrator\assets\ui-orchestrator'
$targetRoot = Join-Path $env:USERPROFILE '.codex\skills\ui-orchestrator'

foreach ($relativePath in $expected.Keys) {
  foreach ($root in @($releaseRoot.Path, $targetRoot)) {
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $root $relativePath)).Hash.ToLowerInvariant()
    if ($actual -ne $expected[$relativePath]) { throw "Integrity mismatch: $root\$relativePath" }
  }
}
foreach ($root in @($releaseRoot.Path, $targetRoot)) {
  $actualFiles = Get-ChildItem -LiteralPath $root -File -Recurse | ForEach-Object {
    $_.FullName.Substring($root.Length + 1)
  }
  if (Compare-Object @($expected.Keys) @($actualFiles)) { throw "File manifest mismatch: $root" }
}
'UI Orchestrator release and installation match the manifest.'
```

Treat a missing file, extra package file, release-ID change, or hash mismatch as requiring human review. Never auto-install, repair, replace, or overwrite either package.
