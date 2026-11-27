$ErrorActionPreference = 'Stop'

foreach ($tool in 'node.exe', 'npm.cmd') {
    if (!(Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw 'Install a supported Node.js version with npm before running SafeOps.'
    }
}

Push-Location -LiteralPath $PSScriptRoot
try {
    $check = @'
const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 24 && !(major === 26 && minor >= 13)) {
  console.error('Use the Node.js version specified in package.json.');
  process.exit(1);
}

let database;
try {
  const { env } = await import('./src/config/env.js');
  await import('./src/config/auth.js');
  const url = new URL(env.databaseUrl ?? '');
  if (env.nodeEnv !== 'development' || env.port !== 3000 ||
      !['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
      url.port !== '39188' || url.pathname !== '/safeops_dev' || !url.username || url.search || url.hash) {
    throw new Error('Unexpected development configuration');
  }
  if (process.argv[2] === 'probe') {
    database = await import('./src/config/database.js');
    const [target] = await database.getDatabase().$queryRaw`
      SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port
    `;
    if (target.name !== 'safeops_dev' || target.host !== '127.0.0.1' || target.port !== 39188) {
      throw new Error('Unexpected connected database');
    }
  }
} catch {
  console.error(process.argv[2] === 'probe'
    ? 'Cannot verify the local safeops_dev connection. Check PostgreSQL and the development database credentials.'
    : 'Invalid local configuration. Verify dependencies, authentication settings, and the loopback safeops_dev URL in .env.');
  process.exitCode = 1;
} finally {
  await database?.disconnectDatabase();
}
'@

    $check | & node.exe --input-type=module - config
    if ($LASTEXITCODE -ne 0) { throw 'SafeOps configuration check failed.' }

    if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
        throw 'Port 3000 is already in use. Check the existing listener before starting SafeOps.'
    }

    & .\scripts\postgres-local.ps1 status
    if ($LASTEXITCODE -ne 0) {
        & .\scripts\postgres-local.ps1 start
        if ($LASTEXITCODE -ne 0) { throw 'The dedicated SafeOps PostgreSQL cluster could not start.' }
    }

    $check | & node.exe --input-type=module - probe
    if ($LASTEXITCODE -ne 0) { throw 'SafeOps database check failed.' }

    Write-Host 'Starting SafeOps at http://localhost:3000/'
    & npm.cmd start
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}
