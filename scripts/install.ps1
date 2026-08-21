<#
    AutomaQA prerequisite installer - Windows
    Installs only what is missing. Every action is printed before it runs.

    Usage:  powershell -ExecutionPolicy Bypass -File scripts\install.ps1 [web|mobile|both]
#>
param(
    [ValidateSet('web', 'mobile', 'both')]
    [string]$Scope = 'both'
)

$script:Failed = $false

function Write-Step { param([string]$Message) Write-Host ""; Write-Host "==> $Message" }
function Write-Ok   { param([string]$Message) Write-Host "  [OK]   $Message" }
function Write-Warn { param([string]$Message) Write-Host "  [WARN] $Message"; $script:Failed = $true }

function Test-Command {
    param([string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Step "AutomaQA prerequisites (scope: $Scope)"

if ($Scope -ne 'mobile') {
    Write-Step "Node.js and npm"
    if (Test-Command node) {
        Write-Ok "node $(node -v)"
        Write-Ok "npm $(npm -v)"
    }
    else {
        Write-Warn "Node.js not found - install the LTS .msi from https://nodejs.org"
    }

    if (Test-Command npm) {
        Write-Step "Playwright and browser drivers"
        npm install --no-fund --no-audit
        if (-not $?) { Write-Warn "npm install failed" }
        npx playwright install chromium
        if (-not $?) { Write-Warn "browser install failed" }
    }
}

if ($Scope -ne 'web') {
    Write-Step "Maestro CLI"
    if (Test-Command maestro) {
        Write-Ok "maestro present"
    }
    elseif (Test-Command scoop) {
        scoop install maestro
        if ($?) { Write-Ok "maestro installed via scoop" } else { Write-Warn "scoop install failed" }
    }
    else {
        Write-Warn "Maestro not found and scoop unavailable. Install scoop (https://scoop.sh) then 'scoop install maestro', or download from https://github.com/mobile-dev-inc/maestro/releases and add maestro.exe to PATH."
    }

    Write-Step "Java (required by Maestro)"
    if (Test-Command java) {
        Write-Ok "java present"
    }
    else {
        Write-Warn "Java 11+ not found - install Eclipse Temurin LTS from https://adoptium.net and tick 'Set JAVA_HOME'"
    }

    Write-Step "Maestro MCP server"
    if (Test-Command claude) {
        $mcpList = claude mcp list 2>$null
        if ($mcpList -match 'maestro') {
            Write-Ok "maestro MCP already registered"
        }
        else {
            claude mcp add --scope user maestro maestro mcp
            if ($?) {
                Write-Ok "registered"
                Write-Host "  Restart Claude Code - MCP servers load at startup."
            }
            else {
                Write-Warn "registration failed; run: claude mcp add --scope user maestro maestro mcp"
            }
        }
    }
    else {
        Write-Warn "claude CLI not found - skipping MCP registration"
    }
}

Write-Step "Done"
if (-not $script:Failed) {
    Write-Host "  Prerequisites satisfied. Next: run /automaqa:setup inside Claude Code."
    exit 0
}
else {
    Write-Host "  Some items need attention - see [WARN] lines above."
    exit 1
}
