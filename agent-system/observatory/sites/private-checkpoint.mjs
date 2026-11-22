import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, link, mkdtemp, realpath, rm, rmdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export async function checkpointFileDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function resolvePrivateCheckpointTarget(destination) {
  destination = resolve(destination);
  const targetDirectory = await realpath(dirname(destination));
  for (let path = targetDirectory; ; path = dirname(path)) {
    if (existsSync(join(path, '.git'))) throw Error('Store checkpoint copies outside Git checkouts');
    if (path === dirname(path)) break;
  }
  return join(targetDirectory, basename(destination));
}

export async function publishPrivateCheckpoint(destination, prepare) {
  const temporary = await mkdtemp(join(dirname(destination), '.snapshot-'));
  const prepared = join(temporary, 'prepared.sqlite');
  try {
    if (process.platform === 'win32') {
      const script = [
        '$ErrorActionPreference = "Stop"',
        '$path = $env:COMMAND_CORE_PRIVATE_DIR',
        '$acl = [IO.Directory]::GetAccessControl($path)',
        '$acl.SetAccessRuleProtection($true, $false)',
        'foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleAll($rule) }',
        '$ids = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User, (New-Object System.Security.Principal.SecurityIdentifier("S-1-5-18")), (New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-544")))',
        'foreach ($id in $ids) { $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($id, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow"); $acl.SetAccessRule($rule) }',
        '[IO.Directory]::SetAccessControl($path, $acl)',
      ].join('; ');
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
        env: { ...process.env, COMMAND_CORE_PRIVATE_DIR: temporary }, timeout: 10000, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      });
    }
    const receipt = await prepare(prepared);
    if (process.platform !== 'win32') {
      await chmod(prepared, 0o600);
      if ((await stat(prepared)).mode & 0o077) throw Error('Checkpoint file permissions could not be restricted');
    }
    // An atomic no-replace publication keeps a racing importer from overwriting the prepared copy.
    await link(prepared, destination);
    return receipt;
  } finally {
    await rm(prepared, { force: true });
    await rmdir(temporary);
  }
}
