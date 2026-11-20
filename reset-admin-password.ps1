$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot 'admin-config.php'
$phpPath = (Get-Command php -ErrorAction SilentlyContinue).Source
if (-not $phpPath -and (Test-Path 'C:\xampp\php\php.exe')) {
    $phpPath = 'C:\xampp\php\php.exe'
}
if (-not $phpPath) { throw 'PHP was not found. Install PHP or add it to PATH first.' }

$configText = [IO.File]::ReadAllText($configPath)
$pattern = '(define\s*\(\s*[''"]AGENTB24_ADMIN_PASSWORD_HASH[''"]\s*,\s*)[''"][^''"]*[''"](\s*\))'
if ([regex]::Matches($configText, $pattern).Count -ne 1) {
    throw 'Expected one password hash definition in admin-config.php. No changes made.'
}

$secret = Read-Host 'Enter a new admin password' -AsSecureString
$confirmation = Read-Host 'Enter it again' -AsSecureString
$password = [Net.NetworkCredential]::new('', $secret).Password
$confirmPassword = [Net.NetworkCredential]::new('', $confirmation).Password
if ($password.Length -lt 12) { throw 'Please use at least 12 characters. No changes made.' }
if ($password -cne $confirmPassword) { throw 'Passwords did not match. No changes made.' }
if ([Text.Encoding]::UTF8.GetByteCount($password) -gt 72) {
    throw 'Use a password of at most 72 UTF-8 bytes. No changes made.'
}

$process = [Diagnostics.Process]::new()
$process.StartInfo.FileName = $phpPath
$process.StartInfo.Arguments = '-r "echo password_hash(stream_get_contents(STDIN), PASSWORD_DEFAULT);"'
$process.StartInfo.UseShellExecute = $false
$process.StartInfo.CreateNoWindow = $true
$process.StartInfo.RedirectStandardInput = $true
$process.StartInfo.RedirectStandardOutput = $true
$process.StartInfo.RedirectStandardError = $true
try {
    [void]$process.Start()
    $passwordBytes = [Text.Encoding]::UTF8.GetBytes($password)
    $inputStream = $process.StandardInput.BaseStream
    $inputStream.Write($passwordBytes, 0, $passwordBytes.Length)
    $inputStream.Flush()
    $inputStream.Close()
    $hash = $process.StandardOutput.ReadToEnd().Trim()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0 -or $hash -notmatch '^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$') {
        throw 'PHP could not generate a valid password hash. No changes made.'
    }
    $updated = [regex]::Replace($configText, $pattern, [Text.RegularExpressions.MatchEvaluator]{
        param($match)
        $match.Groups[1].Value + "'" + $hash + "'" + $match.Groups[2].Value
    })
    [IO.File]::WriteAllText($configPath, $updated, [Text.UTF8Encoding]::new($false))
    Write-Host 'Local admin password updated. Open admin.html through your local PHP server and sign in with the new password.'
} finally {
    if ($passwordBytes) { [Array]::Clear($passwordBytes, 0, $passwordBytes.Length) }
    $password = $null
    $confirmPassword = $null
    $secret.Dispose()
    $confirmation.Dispose()
    $process.Dispose()
}
