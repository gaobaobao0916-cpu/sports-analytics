[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$WorkRoot = Split-Path -Parent $RepoRoot
$LogDir = Join-Path $WorkRoot 'live-results-work\logs'
$RunId = Get-Date -Format 'yyyyMMdd-HHmmss'
$Branch = "auto/live-results-$RunId"
$TaskDate = Get-Date -Format 'yyyy-MM-dd HH:mm'
$TranscriptPath = Join-Path $LogDir "publish-$RunId.log"
$Mutex = New-Object System.Threading.Mutex($false, 'LiveOU.LiveResults.Publisher')
$LockTaken = $false
$ExitCode = 0

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Start-Transcript -Path $TranscriptPath -Force | Out-Null

function Write-Log {
    param([string]$Message)
    $Timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Output "[$Timestamp] $Message"
}

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$CommandArgs
    )
    Write-Log "> $FilePath $($CommandArgs -join ' ')"
    & $FilePath @CommandArgs
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath 执行失败，退出码 $LASTEXITCODE"
    }
}

function Invoke-NetworkChecked {
    # 访问 GitHub 的操作允许重试，避免一次连接重置就放弃整个档期。
    param(
        [string]$FilePath,
        [string[]]$CommandArgs
    )
    $RetryDelays = @(0, 20, 60)
    for ($Attempt = 0; $Attempt -lt $RetryDelays.Count; $Attempt++) {
        if ($Attempt -gt 0) {
            Write-Log "$($RetryDelays[$Attempt]) 秒后进行第 $($Attempt + 1) 次尝试：$FilePath $($CommandArgs -join ' ')"
            Start-Sleep -Seconds $RetryDelays[$Attempt]
        }
        try {
            Invoke-Checked -FilePath $FilePath -CommandArgs $CommandArgs
            return
        } catch {
            if ($Attempt -eq $RetryDelays.Count - 1) {
                throw
            }
            Write-Log "网络操作失败：$($_.Exception.Message)"
        }
    }
}

try {
    if (-not $Mutex.WaitOne(0)) {
        Write-Log '已有自动发布任务正在运行，本次跳过。'
    } else {
        $LockTaken = $true
        Write-Log "开始自动更新；仓库：$RepoRoot"
        Get-Command -Name git, gh, python, node -ErrorAction Stop | Out-Null
        Set-Location $RepoRoot

        $Status = @(& git status --porcelain)
        if ($LASTEXITCODE -ne 0) {
            throw '无法读取自动发布工作区状态。'
        }
        if ($Status.Count -gt 0) {
            throw '自动发布工作区不干净，为避免覆盖改动已停止。请先检查 bot 克隆。'
        }

        Invoke-NetworkChecked git @('fetch', 'origin', '--prune')
        Invoke-Checked git @('switch', 'master')
        Invoke-NetworkChecked git @('pull', '--ff-only', 'origin', 'master')
        Invoke-Checked git @('switch', '-c', $Branch)

        # 导出器仅以 SQLite mode=ro 读取生产归档库，并自动补足 7M 终场。
        Invoke-Checked python @('tools\export_live_results.py', '--log-dir', $LogDir)
        Invoke-Checked node @('--test', 'tests\')

        Invoke-Checked git @('add', '--', 'data/live-results')
        & git diff --cached --quiet -- data/live-results
        $DiffExit = $LASTEXITCODE
        if ($DiffExit -gt 1) {
            throw '检查归档数据差异时失败。'
        }

        if ($DiffExit -eq 0) {
            Write-Log '归档数据没有变化，不创建提交或 PR。'
            Invoke-Checked git @('switch', 'master')
            Invoke-Checked git @('branch', '-d', $Branch)
        } else {
            & git diff --cached --stat
            $env:GIT_AUTHOR_NAME = '随心笔记'
            $env:GIT_AUTHOR_EMAIL = 'gaobaobao0916@gmail.com'
            $env:GIT_COMMITTER_NAME = '随心笔记'
            $env:GIT_COMMITTER_EMAIL = 'gaobaobao0916@gmail.com'
            Invoke-Checked git @('commit', '-m', "chore: update live push results $TaskDate")
            Invoke-NetworkChecked git @('push', '-u', 'origin', $Branch)

            $PrBody = @'
## Summary
- 自动归档已确认送达的 V4 推送。
- 自动查询 7M 终场比分并重新核对 HIT / MISS / REVIEW。
- 数据导出只读生产 SQLite，统计口径不变。

## Verification
- [x] `python tools\export_live_results.py`
- [x] `node --test tests\`
'@
            Invoke-NetworkChecked gh @(
                'pr', 'create', '--base', 'master', '--head', $Branch,
                '--title', "chore: update live push results $TaskDate",
                '--body', $PrBody
            )
            Invoke-NetworkChecked gh @('pr', 'merge', $Branch, '--squash', '--delete-branch')
            Invoke-Checked git @('switch', 'master')
            Invoke-NetworkChecked git @('pull', '--ff-only', 'origin', 'master')
            Write-Log '自动 PR 已合并，GitHub Pages 将发布最新归档。'
        }
        Write-Log '本次自动更新完成。'
    }
} catch {
    $ExitCode = 1
    Write-Log "FAILED：$($_.Exception.Message)"
} finally {
    if ($LockTaken) {
        $Mutex.ReleaseMutex() | Out-Null
    }
    $Mutex.Dispose()
    Stop-Transcript | Out-Null
}

exit $ExitCode
