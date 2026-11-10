$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$projectRoot = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $projectRoot 'test-results.log'

try {
    Set-Location -LiteralPath $projectRoot
    # Prefer the bundled runtime in this Windows environment, then normal Node.
    $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $bundledNode) {
        $nodePath = $bundledNode
    } else {
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $nodeCommand) { throw 'Node.jsが見つかりません。同梱ランタイム、またはNode.jsのインストールを確認してください。' }
        $nodePath = $nodeCommand.Source
    }

    Write-Host 'AWL（分析ワークアウトログ）：全自動テストを実行します。'
    Write-Host "使用するNode.js：$nodePath"
    Write-Host 'ブラウザやiPhoneの保存データにはアクセスしません。'
    Write-Host ''

    # TAP preserves failure locations, expected/actual values, and stack traces.
    # Explicit files avoid accidentally running unrelated scripts outside tests.
    $testFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'tests') -Recurse -File -Filter '*.test.cjs' | Sort-Object FullName | ForEach-Object { $_.FullName })
    if ($testFiles.Count -eq 0) { throw 'testsフォルダにテストファイルがありません。' }
    $lines = [System.Collections.Generic.List[string]]::new()
    & $nodePath --test --test-reporter=tap @testFiles 2>&1 | ForEach-Object {
        $line = $_.ToString()
        $lines.Add($line)
        Write-Host $line
    }
    $testExit = $LASTEXITCODE
    [System.IO.File]::WriteAllLines($logPath, $lines, [System.Text.UTF8Encoding]::new($true))

    $passed = $null
    $failed = $null
    foreach ($line in $lines) {
        if ($line -match '^# pass (\d+)\s*$') { $passed = [int]$Matches[1] }
        if ($line -match '^# fail (\d+)\s*$') { $failed = [int]$Matches[1] }
    }
    Write-Host ''
    Write-Host '========== テスト結果 =========='
    if ($null -eq $passed -or $null -eq $failed) {
        Write-Host '実行エラー：成功・失敗件数を取得できませんでした。' -ForegroundColor Red
        $testExit = 1
    } else {
        Write-Host "成功：$passed 件 ／ 失敗：$failed 件"
        if ($testExit -eq 0 -and $failed -eq 0 -and $passed -gt 0) {
            Write-Host 'すべてのテストに成功しました。' -ForegroundColor Green
        } else {
            Write-Host '失敗または実行エラーがあります。上の「not ok」と、その下のエラー内容・ファイル名・行番号を確認してください。' -ForegroundColor Red
            $testExit = 1
        }
    }
    Write-Host "詳細ログ：$logPath"
    Write-Host '相談するときは test-results.log の内容を共有してください（実行のたびに上書きします）。'
    exit $testExit
} catch {
    $message = "テストを実行できませんでした：$($_.Exception.Message)"
    Write-Host $message -ForegroundColor Red
    Write-Host '成功件数・失敗件数は未確定です。表示されたエラーを確認してください。'
    [System.IO.File]::WriteAllText($logPath, $message, [System.Text.UTF8Encoding]::new($true))
    exit 1
}
