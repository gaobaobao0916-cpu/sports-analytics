[CmdletBinding()]
param([switch]$RunNow)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$WorkRoot = Split-Path -Parent $RepoRoot
$LogDir = Join-Path $WorkRoot 'live-results-work\logs'
$LogPath = Join-Path $LogDir 'scheduler.log'
$StatePath = Join-Path $LogDir 'scheduler-state.txt'
$Publisher = Join-Path $PSScriptRoot 'publish_live_results.ps1'
$Mutex = New-Object System.Threading.Mutex($false, 'LiveOU.LiveResults.Scheduler')
$LockTaken = $false
$ExitCode = 0
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Write-SchedulerLog {
    param([string]$Message)
    $Timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $Line = "[$Timestamp] $Message"
    [System.IO.File]::AppendAllText($LogPath, $Line + [Environment]::NewLine, $Utf8NoBom)
    Write-Host $Line
}

function Get-NextRun {
    param([datetime]$After)

    foreach ($Hour in @(8, 20)) {
        $Candidate = $After.Date.AddHours($Hour)
        if ($Candidate -gt $After) {
            return $Candidate
        }
    }
    return $After.Date.AddDays(1).AddHours(8)
}

function Get-LatestDueSlot {
    param([datetime]$Now)

    $Slots = @(
        $Now.Date.AddHours(8),
        $Now.Date.AddHours(20),
        $Now.Date.AddDays(-1).AddHours(20)
    )
    return $Slots | Where-Object { $_ -le $Now } |
        Sort-Object -Descending | Select-Object -First 1
}

function Invoke-Publisher {
    param([datetime]$Slot)

    # 每个档期最多执行两次：首次失败后 10 分钟自动重试一次。
    for ($Attempt = 1; $Attempt -le 2; $Attempt++) {
        Write-SchedulerLog "开始执行自动导出、核对与发布（档期 $($Slot.ToString('yyyy-MM-dd HH:mm'))，第 $Attempt 次）。"
        $ProcessArgs = @(
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', ('"{0}"' -f $Publisher)
        )
        $Process = Start-Process -FilePath 'powershell.exe' `
            -ArgumentList $ProcessArgs `
            -WorkingDirectory $RepoRoot `
            -NoNewWindow -Wait -PassThru
        Write-SchedulerLog "自动发布进程结束，退出码 $($Process.ExitCode)。"
        if ($Process.ExitCode -eq 0) {
            break
        }
        if ($Attempt -lt 2) {
            Write-SchedulerLog '本次失败，10 分钟后自动重试一次。'
            Start-Sleep -Seconds 600
        }
    }
    # 记录已执行的档期（含失败），避免重启后反复补跑同一档期。
    [System.IO.File]::WriteAllText($StatePath, $Slot.ToString('yyyy-MM-dd HH:mm'), $Utf8NoBom)
}

try {
    if (-not $Mutex.WaitOne(0)) {
        Write-SchedulerLog '已有常驻调度器正在运行，本次退出。'
    } else {
        $LockTaken = $true
        if (-not (Test-Path -LiteralPath $Publisher -PathType Leaf)) {
            throw "找不到发布器：$Publisher"
        }

        Write-SchedulerLog "调度器已启动；PID=$PID；RunNow=$RunNow。"
        if ($RunNow) {
            try {
                Invoke-Publisher -Slot (Get-Date)
            } catch {
                Write-SchedulerLog "立即试跑失败：$($_.Exception.Message)"
            }
        } else {
            # 启动时补跑错过的档期（例如开机时间晚于 08:00 / 20:00）。
            $DueSlot = Get-LatestDueSlot -Now (Get-Date)
            $LastSlot = [datetime]::MinValue
            if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
                $RawState = (Get-Content -LiteralPath $StatePath -Raw).Trim()
                [datetime]::TryParse($RawState, [ref]$LastSlot) | Out-Null
            }
            if ($DueSlot -and $DueSlot -gt $LastSlot) {
                Write-SchedulerLog "检测到未执行的档期 $($DueSlot.ToString('yyyy-MM-dd HH:mm'))，立即补跑。"
                try {
                    Invoke-Publisher -Slot $DueSlot
                } catch {
                    Write-SchedulerLog "补跑失败：$($_.Exception.Message)"
                }
            }
        }

        while ($true) {
            $NextRun = Get-NextRun -After (Get-Date)
            Write-SchedulerLog "下次运行时间：$($NextRun.ToString('yyyy-MM-dd HH:mm:ss'))。"
            while ($true) {
                $Remaining = ($NextRun - (Get-Date)).TotalSeconds
                if ($Remaining -le 0) {
                    break
                }
                $SleepSeconds = [Math]::Min(60, [Math]::Max(1, [Math]::Ceiling($Remaining)))
                Start-Sleep -Seconds $SleepSeconds
            }

            try {
                Invoke-Publisher -Slot $NextRun
            } catch {
                Write-SchedulerLog "定时运行失败：$($_.Exception.Message)"
            }
        }
    }
} catch {
    $ExitCode = 1
    Write-SchedulerLog "调度器异常退出：$($_.Exception.Message)"
} finally {
    if ($LockTaken) {
        $Mutex.ReleaseMutex() | Out-Null
    }
    $Mutex.Dispose()
}

exit $ExitCode
