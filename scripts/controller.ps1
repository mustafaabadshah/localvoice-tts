<#
.SYNOPSIS
    Installs and controls the LocalVoice backend controller.

.DESCRIPTION
    Chrome extensions cannot start local processes, so "the backend starts when I use the
    extension" needs one small helper outside the browser. This script registers
    backend\controller.py as a logon task: it listens on 127.0.0.1:8766, starts the backend
    on demand and stops it again after -IdleMinutes without a request.

        .\scripts\controller.ps1                    # install + start (auto-off after 5 min)
        .\scripts\controller.ps1 -IdleMinutes 30    # reinstall with a different idle window
        .\scripts\controller.ps1 -IdleMinutes 0     # never auto-stop
        .\scripts\controller.ps1 -Action status     # what the controller sees right now
        .\scripts\controller.ps1 -Action stop       # backend down, controller keeps listening
        .\scripts\controller.ps1 -Action uninstall  # remove the logon task entirely

.PARAMETER Action
    install (default), start, stop, restart, status, uninstall.

.PARAMETER IdleMinutes
    Stop the backend after this many minutes without a request from the extension. 0 disables.

.PARAMETER Port
    Controller port. Must match DEFAULT_CONTROLLER_URL in the extension.
#>
[CmdletBinding()]
param(
    [ValidateSet('install', 'start', 'stop', 'restart', 'status', 'uninstall')]
    [string]$Action = 'install',

    [int]$IdleMinutes = 5,

    [int]$Port = 8766
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $ProjectRoot 'backend'
$Controller = Join-Path $BackendDir 'controller.py'
$VenvPython = Join-Path $BackendDir '.venv\Scripts\python.exe'
$VenvPythonw = Join-Path $BackendDir '.venv\Scripts\pythonw.exe'
$TaskName = 'LocalVoice Backend Controller'
$StatusUrl = "http://127.0.0.1:$Port/status"

function Write-Step([string]$Message) { Write-Host "  $Message" -ForegroundColor Gray }
function Write-Ok([string]$Message) { Write-Host "  $Message" -ForegroundColor Green }
function Write-Note([string]$Message) { Write-Host "  $Message" -ForegroundColor Yellow }

function Get-ControllerStatus {
    try {
        return Invoke-RestMethod -Uri $StatusUrl -TimeoutSec 4
    } catch {
        return $null
    }
}

function Wait-Controller([int]$Seconds = 15) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Get-ControllerStatus) { return $true }
        Start-Sleep -Milliseconds 300
    }
    return $false
}

function Get-ControllerTask {
    return Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

switch ($Action) {

    'install' {
        if (-not (Test-Path -LiteralPath $Controller)) {
            throw "controller.py not found at $Controller"
        }
        if (-not (Test-Path -LiteralPath $VenvPython)) {
            throw 'Backend venv missing. Run .\scripts\setup.ps1 first.'
        }

        $pythonw = if (Test-Path -LiteralPath $VenvPythonw) { $VenvPythonw } else { $VenvPython }
        $idleSeconds = $IdleMinutes * 60
        $currentUser = "$env:USERDOMAIN\$env:USERNAME"

        Write-Host 'Installing the LocalVoice controller' -ForegroundColor Cyan
        Write-Step "python     $pythonw"
        Write-Step "idle stop  $(if ($idleSeconds -gt 0) { "$IdleMinutes min" } else { 'disabled' })"

        # -Argument quotes the script path because the task scheduler hands the string to
        # CreateProcess verbatim - this repository lives under "MM Office", which would
        # otherwise split into two arguments and start python with a path that does not exist.
        $taskAction = New-ScheduledTaskAction `
            -Execute $pythonw `
            -Argument ('"{0}" --port {1} --idle-seconds {2}' -f $Controller, $Port, $idleSeconds) `
            -WorkingDirectory $BackendDir

        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
        $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -ExecutionTimeLimit ([TimeSpan]::Zero) `
            -MultipleInstances IgnoreNew `
            -RestartCount 3 `
            -RestartInterval (New-TimeSpan -Minutes 1)

        Register-ScheduledTask `
            -TaskName $TaskName `
            -Action $taskAction `
            -Trigger $trigger `
            -Principal $principal `
            -Settings $settings `
            -Description 'Starts and idle-stops the LocalVoice TTS backend on demand.' `
            -Force | Out-Null
        Write-Ok "Logon task '$TaskName' registered"

        # Re-installing: the previous instance still holds the port and the old idle window.
        if (Get-ControllerStatus) {
            Write-Note 'A controller is already listening - restarting it with the new settings'
            Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
            & (Join-Path $ScriptDir 'stop.ps1') | Out-Null
            Start-Sleep -Milliseconds 700
        }

        Start-ScheduledTask -TaskName $TaskName
        if (Wait-Controller 25) {
            Write-Ok "Controller online at http://127.0.0.1:$Port"
            Write-Host ''
            if ($idleSeconds -gt 0) {
                Write-Host 'Done. Press Read Page in the extension: the backend starts itself and' -ForegroundColor Green
                Write-Host "stops again after $IdleMinutes minutes without use. The power button overrides it." -ForegroundColor Green
            } else {
                Write-Host 'Done. Press Read Page in the extension: the backend starts itself.' -ForegroundColor Green
                Write-Host "Idle stop is disabled; the popup's power button is the way to stop it." -ForegroundColor Green
            }
            exit 0
        }

        Write-Note "Controller did not answer on port $Port within 25s."
        Write-Note 'Check backend\logs\controller.log for the reason.'
        exit 1
    }

    'start' {
        if (-not (Get-ControllerTask)) {
            throw 'The controller is not installed. Run .\scripts\controller.ps1 first.'
        }
        if (Get-ControllerStatus) {
            Write-Ok "Controller already listening on $Port"
            exit 0
        }
        Start-ScheduledTask -TaskName $TaskName
        if (-not (Wait-Controller 25)) {
            throw "Controller did not answer on port $Port. See backend\logs\controller.log."
        }
        Write-Ok "Controller online at http://127.0.0.1:$Port"
    }

    'stop' {
        # Stop the engine through the controller first, so nothing is left holding port 8765.
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:$Port/stop" -Method Post -TimeoutSec 30 | Out-Null
        } catch {
            Write-Step 'Controller not answering - stopping the backend directly'
            & (Join-Path $ScriptDir 'stop.ps1') | Out-Null
            Write-Ok 'Controller is not running'
            return
        }

        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Write-Ok 'Backend stopped, controller stopped'
    }

    'restart' {
        & $PSCommandPath -Action stop -Port $Port
        Start-Sleep -Milliseconds 500
        & $PSCommandPath -Action start -Port $Port
    }

    'status' {
        $status = Get-ControllerStatus
        if (-not $status) {
            Write-Note "No controller on port $Port. Run .\scripts\controller.ps1 to install it."
            exit 1
        }
        $task = Get-ControllerTask
        Write-Host "LocalVoice controller $($status.version)" -ForegroundColor Cyan
        Write-Step "task         $(if ($task) { $task.State } else { 'not registered' })"
        Write-Step "backend      $($status.backend)$(if ($status.pid) { " (pid $($status.pid))" })"
        Write-Step "backend url  $($status.backend_url)"
        if ($status.idle_seconds -gt 0) {
            $left = if ($null -ne $status.idle_remaining_seconds) { " ($($status.idle_remaining_seconds)s left)" } else { '' }
            Write-Step "auto-off     $([int]($status.idle_seconds / 60)) min$left"
        } else {
            Write-Step 'auto-off     disabled'
        }
    }

    'uninstall' {
        & $PSCommandPath -Action stop -Port $Port
        if (Get-ControllerTask) {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            Write-Ok "Logon task '$TaskName' removed"
        } else {
            Write-Step 'Nothing to uninstall'
        }
        Write-Step 'Start the backend manually with .\scripts\start.ps1 from now on.'
    }
}
