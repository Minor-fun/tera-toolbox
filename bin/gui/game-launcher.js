'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

function validateExecutable(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.exe')
        throw new Error('launcher-path');
    try {
        const resolved = fs.realpathSync(file);
        if (!fs.statSync(resolved).isFile()) throw new Error();
        const header = Buffer.alloc(2), fd = fs.openSync(resolved, 'r');
        try { fs.readSync(fd, header, 0, 2, 0); } finally { fs.closeSync(fd); }
        if (header.toString('ascii') !== 'MZ') throw new Error();
        return resolved;
    } catch (_) { throw new Error('launcher-path'); }
}

function queryProcesses() {
    if (process.platform !== 'win32') return Promise.reject(new Error('launcher-check-failed'));
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    // This command is fixed. User paths/names never become PowerShell source or command-line arguments.
    const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); " +
        "$rows=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,@{Name='Started';Expression={if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{''}}}); " +
        'ConvertTo-Json -InputObject $rows -Compress';
    return new Promise((resolve, reject) => {
        execFile(executable, ['-NoProfile', '-NonInteractive', '-Command', script],
            { windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (error, output) => {
                if (error) { reject(new Error('launcher-check-failed')); return; }
                try {
                    const rows = JSON.parse(output.replace(/^\uFEFF/, ''));
                    if (!Array.isArray(rows) || rows.some(row => !row || !Number.isInteger(row.ProcessId) || typeof row.Name !== 'string')) throw new Error();
                    resolve(rows);
                } catch (_) { reject(new Error('launcher-check-failed')); }
            });
    });
}

function spawnLauncher(file) {
    return new Promise((resolve, reject) => {
        const child = spawn(file, [], { cwd: path.dirname(file), detached: true, stdio: 'ignore', shell: false });
        child.once('error', () => reject(new Error('launcher-failed')));
        child.once('spawn', () => { child.unref(); resolve(child); });
    });
}

const normalizedPath = value => typeof value === 'string' ? path.win32.normalize(value).toLowerCase() : '';
const busyStatuses = new Set(['pending', 'checking', 'launching']);

class GameLauncher {
    constructor({ query = queryProcesses, launch = spawnLauncher, validate = validateExecutable, onStatus = () => {} } = {}) {
        this.query = query;
        this.launch = launch;
        this.validate = validate;
        this.onStatus = onStatus;
        this.operation = 0;
        this.status = { operation: 0, status: 'idle' };
        this.tracked = new Map();
    }

    get busy() { return busyStatuses.has(this.status.status); }

    publish(status, profile, error) {
        this.status = { operation: this.operation, status, serverId: profile && profile.id || '', serverName: profile && profile.name || '' };
        if (error) this.status.error = error;
        try { this.onStatus(this.status); } catch (_) { /* A closed renderer must not change the launch outcome. */ }
    }

    begin(profile) {
        this.operation++;
        this.profile = profile ? { ...profile } : null;
        this.publish(profile ? 'pending' : 'idle', this.profile);
        return this.operation;
    }

    cancel() {
        if (!this.busy) return;
        this.operation++;
        this.publish('cancelled', this.profile);
        this.profile = null;
    }

    async run(operation, isCurrent) {
        if (operation !== this.operation || this.status.status !== 'pending') return;
        const profile = this.profile;
        const current = () => operation === this.operation && isCurrent();
        const finish = (status, error) => { if (current()) this.publish(status, profile, error); };
        if (!profile || !current()) { this.cancel(); return; }
        if (!profile.launcherPath) { finish('unconfigured'); return; }
        try {
            this.publish('checking', profile);
            const rows = await this.query();
            if (!current()) { if (operation === this.operation) this.cancel(); return; }
            if (rows.some(row => /^(TERA|VTEQ)\.exe$/i.test(row.Name))) { finish('game-running'); return; }
            const file = this.validate(profile.launcherPath), key = normalizedPath(file);
            if (rows.some(row => normalizedPath(row.ExecutablePath) === key)) { finish('already-running'); return; }
            if (rows.some(row => row.Name.toLowerCase() === path.win32.basename(key) && !row.ExecutablePath)) {
                finish('failed', 'launcher-check-failed'); return;
            }
            const tracked = this.tracked.get(key);
            if (tracked) {
                const root = rows.find(row => row.ProcessId === tracked.pid);
                const descendants = rows.filter(row => row.ParentProcessId === tracked.pid && Date.parse(row.Started) >= tracked.started);
                // A transferred launcher may outlive its initial EXE. Never treat a reused PID as its parent.
                if ((root && normalizedPath(root.ExecutablePath) === key) || (!root && descendants.length)) {
                    finish('already-running'); return;
                }
                this.tracked.delete(key);
            }
            if (!current()) return;
            this.publish('launching', profile);
            const started = Date.now();
            const child = await this.launch(file);
            if (child && Number.isInteger(child.pid)) this.tracked.set(key, { pid: child.pid, started });
            finish('opened');
        } catch (error) {
            finish('failed', ['launcher-path', 'launcher-check-failed'].includes(error.message) ? error.message : 'launcher-failed');
        }
    }
}

module.exports = { GameLauncher, validateExecutable, queryProcesses, spawnLauncher };
