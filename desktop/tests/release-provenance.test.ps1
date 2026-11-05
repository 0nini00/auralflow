#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$releaseScript = Join-Path $PSScriptRoot '..\build-release.ps1'
$gitExecutable = (Get-Command git -CommandType Application | Select-Object -First 1).Source
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('auralflow-release-tests-' + [guid]::NewGuid().ToString('N'))
$previousKey = $env:TAURI_SIGNING_PRIVATE_KEY
$previousPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
New-Item -ItemType Directory -Path $testRoot | Out-Null
$failures = [Collections.Generic.List[string]]::new()
$global:releaseTest_passed = 0

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Invoke-RealGit([string[]]$Arguments) {
    $output = & $gitExecutable @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Git fixture failed: $output" }
    return $output
}

# 只将脚本声明的 GitHub 仓库映射为临时 bare repo，其余 Git 操作真实执行。
function git {
    $arguments = @($args | ForEach-Object {
        if ($_ -eq 'https://github.com/0nini00/auralflow.git') { $global:releaseTest_remotePath } else { $_ }
    })
    & $gitExecutable @arguments
    $global:LASTEXITCODE = $LASTEXITCODE
}

# 签名配置读取由测试替身截获，绝不访问机器上的真实签名目录。
function Get-Content {
    param([Parameter(Position = 0)][string]$Path, [switch]$Raw)
    if ($Path -eq 'F:\auralflow-secrets\updater-signing.properties') {
        $global:releaseTest_secretReads++
        return @("keyPath=$global:releaseTest_fixtureKey", 'password=synthetic-password')
    }
    if ($Path.StartsWith('F:\auralflow-secrets', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Test attempted to access real signing material'
    }
    Microsoft.PowerShell.Management\Get-Content -LiteralPath $Path -Raw:$Raw
}

function Test-Path {
    param([Parameter(Position = 0)][string]$Path)
    if ($Path -eq 'F:\auralflow-secrets\updater-signing.properties') { return $true }
    if ($Path.StartsWith('F:\auralflow-secrets', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Test attempted to access real signing material'
    }
    Microsoft.PowerShell.Management\Test-Path -LiteralPath $Path
}

function pnpm {
    $global:releaseTest_buildCalls++
    $arguments = @($args)
    if ($arguments -contains 'sign') {
        Set-Content -LiteralPath ($arguments[-1] + '.sig') -Value ('s' * 80)
    } else {
        $bundle = Join-Path $global:releaseTest_fixtureRepo 'desktop\src-tauri\target\release\bundle\nsis'
        New-Item -ItemType Directory -Force -Path $bundle | Out-Null
        Set-Content -LiteralPath (Join-Path $bundle 'AuralFlow_1.2.3_x64-setup.exe') -Value 'synthetic installer'
        Set-Content -LiteralPath (Join-Path $bundle 'AuralFlow_1.2.3_x64-setup.exe.sig') -Value ('s' * 80)
        Set-Content -LiteralPath (Join-Path $global:releaseTest_fixtureRepo 'desktop\src-tauri\target\release\auralflow.exe') -Value 'synthetic portable'
        if ($global:releaseTest_buildMutation -eq 'dirty') {
            Add-Content -LiteralPath (Join-Path $global:releaseTest_fixtureRepo 'source.txt') -Value 'changed during build'
        } elseif ($global:releaseTest_buildMutation -eq 'commit') {
            Invoke-RealGit @('-C', $global:releaseTest_fixtureRepo, 'commit', '--allow-empty', '-m', 'advanced during build') | Out-Null
        }
    }
    $global:LASTEXITCODE = 0
}

function gh {
    $arguments = @($args)
    $global:releaseTest_ghCalls.Add($arguments)
    if ($arguments[1] -eq 'view') {
        $global:LASTEXITCODE = if ($global:releaseTest_releaseExists) { 0 } else { 1 }
        return
    }
    if ($arguments[1] -eq 'create') {
        $targetIndex = [array]::IndexOf($arguments, '--target')
        $target = if ($targetIndex -ge 0) { $arguments[$targetIndex + 1] } else { $global:releaseTest_remoteDefaultCommit }
        $existing = & $gitExecutable -C $global:releaseTest_fixtureRepo rev-parse --verify 'refs/tags/v1.2.3' 2>$null
        if ($LASTEXITCODE -ne 0) {
            Invoke-RealGit @('-C', $global:releaseTest_fixtureRepo, 'tag', 'v1.2.3', $target) | Out-Null
            Invoke-RealGit @('-C', $global:releaseTest_fixtureRepo, 'push', 'origin', 'refs/tags/v1.2.3') | Out-Null
        }
    }
    $global:LASTEXITCODE = 0
}

function New-Fixture([string]$Name, [string]$TagKind = '') {
    $global:releaseTest_fixtureRepo = Join-Path $testRoot $Name
    $global:releaseTest_remotePath = Join-Path $testRoot "$Name.git"
    $global:releaseTest_fixtureKey = Join-Path $testRoot "$Name.synthetic-key"
    $global:releaseTest_ghCalls = [Collections.Generic.List[object]]::new()
    $global:releaseTest_secretReads = 0
    $global:releaseTest_buildCalls = 0
    $global:releaseTest_buildMutation = ''
    $global:releaseTest_releaseExists = $false
    New-Item -ItemType Directory -Path (Join-Path $global:releaseTest_fixtureRepo 'desktop\src-tauri') -Force | Out-Null
    Copy-Item -LiteralPath $releaseScript -Destination (Join-Path $global:releaseTest_fixtureRepo 'desktop\build-release.ps1')
    Set-Content -LiteralPath $global:releaseTest_fixtureKey -Value 'synthetic-private-key'
    Set-Content -LiteralPath (Join-Path $global:releaseTest_fixtureRepo '.gitignore') -Value @('/dist/', '/desktop/src-tauri/target/')
    Set-Content -LiteralPath (Join-Path $global:releaseTest_fixtureRepo 'source.txt') -Value 'fixture source'
    foreach ($path in @('package.json', 'desktop\package.json', 'desktop\src-tauri\tauri.conf.json')) {
        Set-Content -LiteralPath (Join-Path $global:releaseTest_fixtureRepo $path) -Value '{"version":"1.2.3"}'
    }
    Set-Content -LiteralPath (Join-Path $global:releaseTest_fixtureRepo 'desktop\src-tauri\Cargo.toml') -Value 'version = "1.2.3"'
    Invoke-RealGit @('init', '--bare', $global:releaseTest_remotePath) | Out-Null
    Invoke-RealGit @('init', '-b', 'main', $global:releaseTest_fixtureRepo) | Out-Null
    Invoke-RealGit @('-C', $global:releaseTest_fixtureRepo, 'config', 'user.name', 'Release Test') | Out-Null
    Invoke-RealGit @('-C', $global:releaseTest_fixtureRepo, 'config', 'user.email', 'release-test@example.invalid') | Out-Null
    Invoke-RealGit @('-C', $global:releaseTest_fixtureRepo, 'add', '.') | Out-Null
    Invoke-RealGit @('-C', $global:releaseTest_fixtureRepo, 'commit', '-m', 'default branch source') | Out-Null
    $global:releaseTest_remoteDefaultCommit = [string](Invoke-RealGit @('-C', $global:releaseTest_fixtureRepo, 'rev-parse', 'HEAD'))
    Invoke-RealGit @('-C', $global:releaseTest_fixtureRepo, 'remote', 'add', 'origin', $global:releaseTest_remotePath) | Out-Null
    Invoke-RealGit @('-C', $global:releaseTest_fixtureRepo, 'push', 'origin', 'main') | Out-Null
    Invoke-RealGit @('-C', $global:releaseTest_fixtureRepo, 'commit', '--allow-empty', '-m', 'build source') | Out-Null
    $global:releaseTest_buildCommit = [string](Invoke-RealGit @('-C', $global:releaseTest_fixtureRepo, 'rev-parse', 'HEAD'))
    Invoke-RealGit @('-C', $global:releaseTest_fixtureRepo, 'push', 'origin', 'HEAD:refs/heads/build-source') | Out-Null
    if ($TagKind) {
        $target = if ($TagKind -eq 'wrong') { $global:releaseTest_remoteDefaultCommit } else { $global:releaseTest_buildCommit }
        $arguments = @('-C', $global:releaseTest_fixtureRepo, 'tag')
        if ($TagKind -eq 'annotated') { $arguments += @('-a', '-m', 'annotated fixture') }
        Invoke-RealGit ($arguments + @('v1.2.3', $target)) | Out-Null
        Invoke-RealGit @('-C', $global:releaseTest_fixtureRepo, 'push', 'origin', 'refs/tags/v1.2.3') | Out-Null
    }
}

function Run-Release([switch]$Publish) {
    $global:releaseTest_releaseError = $null
    try { & (Join-Path $global:releaseTest_fixtureRepo 'desktop\build-release.ps1') -Publish:$Publish -Notes 'test notes' 6>$null }
    catch { $global:releaseTest_releaseError = $_.Exception.Message }
}

function Assert-NoReleaseWrites {
    $writes = @($global:releaseTest_ghCalls | Where-Object { $_[1] -in @('create', 'upload') })
    Assert-True ($writes.Count -eq 0) 'Refused build must not create a release or upload assets'
}

function Test-Case([string]$Name, [scriptblock]$Body) {
    try { & $Body; $global:releaseTest_passed++; Write-Host "PASS $Name" }
    catch { $failures.Add("${Name}: $($_.Exception.Message)"); Write-Host "FAIL ${Name}: $($_.Exception.Message)" }
}

try {
    Test-Case 'new release targets the built commit even when default branch differs' {
        New-Fixture 'new-release'
        Run-Release -Publish
        Assert-True (-not $global:releaseTest_releaseError) "Unexpected error: $global:releaseTest_releaseError"
        $create = @($global:releaseTest_ghCalls | Where-Object { $_[1] -eq 'create' })[0]
        $index = [array]::IndexOf($create, '--target')
        Assert-True ($index -ge 0 -and $create[$index + 1] -eq $global:releaseTest_buildCommit) 'Release must pass --target with the exact build SHA'
        $actual = [string](Invoke-RealGit @('--git-dir', $global:releaseTest_remotePath, 'rev-parse', 'refs/tags/v1.2.3'))
        Assert-True ($actual -eq $global:releaseTest_buildCommit) 'Remote tag does not match the build'
    }
    foreach ($kind in @('lightweight', 'annotated')) {
        Test-Case "existing $kind tag on build commit permits replacement" {
            New-Fixture "same-$kind" $kind
            $global:releaseTest_releaseExists = $true
            Run-Release -Publish
            Assert-True (-not $global:releaseTest_releaseError) "Unexpected error: $global:releaseTest_releaseError"
            Assert-True (@($global:releaseTest_ghCalls | Where-Object { $_[1] -eq 'upload' }).Count -eq 4) 'Expected four release uploads'
        }
    }
    Test-Case 'tag mismatch prevents replacing an existing release' {
        New-Fixture 'wrong-tag' 'wrong'
        $global:releaseTest_releaseExists = $true
        Run-Release -Publish
        Assert-True ([bool]$global:releaseTest_releaseError) 'Expected tag mismatch rejection'
        Assert-NoReleaseWrites
    }
    Test-Case 'dirty publishing is rejected before reading signing configuration' {
        New-Fixture 'dirty-publish'
        Add-Content -LiteralPath (Join-Path $global:releaseTest_fixtureRepo 'source.txt') -Value 'uncommitted'
        Run-Release -Publish
        Assert-True ([bool]$global:releaseTest_releaseError) 'Expected dirty source rejection'
        Assert-True ($global:releaseTest_secretReads -eq 0 -and $global:releaseTest_buildCalls -eq 0) 'Dirty publication must fail before signing and building'
        Assert-NoReleaseWrites
    }
    foreach ($mutation in @('dirty', 'commit')) {
        Test-Case "source $mutation during build prevents publishing" {
            New-Fixture "changed-$mutation"
            $global:releaseTest_buildMutation = $mutation
            Run-Release -Publish
            Assert-True ([bool]$global:releaseTest_releaseError) 'Expected changed build source rejection'
            Assert-NoReleaseWrites
        }
    }
    Test-Case 'dirty local build remains usable and records provenance' {
        New-Fixture 'dirty-local'
        Add-Content -LiteralPath (Join-Path $global:releaseTest_fixtureRepo 'source.txt') -Value 'local draft'
        Run-Release
        Assert-True (-not $global:releaseTest_releaseError) "Unexpected error: $global:releaseTest_releaseError"
        $path = Join-Path $global:releaseTest_fixtureRepo 'dist\source-provenance.json'
        Assert-True (Microsoft.PowerShell.Management\Test-Path -LiteralPath $path) 'Missing source provenance'
        $record = Microsoft.PowerShell.Management\Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        Assert-True ($record.commit -eq $global:releaseTest_buildCommit -and $record.dirty) 'Dirty provenance must identify the actual build source'
        Assert-NoReleaseWrites
    }
    Test-Case 'existing release without a verifiable tag cannot receive assets' {
        New-Fixture 'missing-tag'
        $global:releaseTest_releaseExists = $true
        Run-Release -Publish
        Assert-True ([bool]$global:releaseTest_releaseError) 'Expected missing tag rejection'
        Assert-NoReleaseWrites
    }
} finally {
    $env:TAURI_SIGNING_PRIVATE_KEY = $previousKey
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $previousPassword
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $allowedPrefix = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'auralflow-release-tests-')
    if (-not $resolved.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe test cleanup path: $resolved" }
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath $resolved -Recurse -Force
}

Write-Host "Release provenance tests: $global:releaseTest_passed passed, $($failures.Count) failed"
if ($failures.Count) { throw ($failures -join [Environment]::NewLine) }
