const mui = require('tera-toolbox-mui').DefaultInstance;
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { CoreModules, listModuleInfos } = require('tera-mod-management');

function forcedirSync(dir) {
    const sep = path.sep;
    const initDir = path.isAbsolute(dir) ? sep : '';
    dir.split(sep).reduce((parentDir, childDir) => {
        const curDir = path.resolve(parentDir, childDir);
        try {
            fs.mkdirSync(curDir);
        } catch (err) {
            // Ignore
        }

        return curDir;
    }, initDir);
}

function hash(data) {
    return crypto.createHash('sha256').update(data).digest().toString('hex').toUpperCase();
}

function walkdir(dir, listFiles = true, listDirs = false, listRootDir = "") {
    let results = [];
    fs.readdirSync(dir).forEach(function(file) {
        const fullpath = path.join(dir, file);
        const relpath = path.join(listRootDir, file);
        const stat = fs.statSync(fullpath);
        if (stat && stat.isDirectory()) {
            if (listDirs)
                results.push(relpath);
            results = results.concat(walkdir(fullpath, listFiles, listDirs, relpath));
        } else {
            if (listFiles)
                results.push(relpath);
        }
    });
    return results;
}

let HTTPAgent = new http.Agent({
    keepAlive: true
});
let HTTPSAgent = new https.Agent({
    keepAlive: true
});

async function autoUpdateFile(file, filepath, url, drmKey, expectedHash = null, receiveAs = "buffer") {
    try {
        let fileUrl = new URL(url);
        if (drmKey)
            fileUrl.searchParams.append('drmkey', drmKey);

        const requestPayload = await fetch(fileUrl, { "agent": (fileUrl.protocol === "https:") ? HTTPSAgent : HTTPAgent });
        if (!requestPayload.ok)
            throw `ERROR: ${url}\nCan't download file from update server (${requestPayload.status} - ${requestPayload.statusText})! Possible causes:\n   + Incorrect manifest specified by developer\n   + Server is not available anymore\n   + Access denied\n   + Internal server error`;

        let updatedFile = await requestPayload.buffer();

        if (receiveAs === "json") {
            try {
                JSON.parse(updatedFile);
            } catch (e) {
                throw `ERROR: ${ url }\nMalformed JSON file!\n${e}`;
            }
        }

        if (expectedHash && expectedHash !== hash(updatedFile))
            throw `ERROR: ${url}\nDownloaded file doesn't match hash specified in patch manifest! Possible causes:\n   + Incorrect manifest specified by developer\n   + NoPing (if you're using it) has a bug that can fuck up the download`;

        forcedirSync(path.dirname(filepath));
        fs.writeFileSync(filepath, updatedFile);
        return [file, true, ""];
    } catch (e) {
        let err = e;
        if (drmKey && err.message) err.message = err.message.split(`drmkey=${drmKey}`).join("drmkey=[censored]");
        return [file, false, err];
    }
}

function migrateModuleUpdateUrlRoot(update_url_root) {
    let finalUrlRoot = update_url_root;
    finalUrlRoot = finalUrlRoot.replace("Kaseaa", "Kasea");
    finalUrlRoot = finalUrlRoot.replace("teramods.ml", "teragame.su");

    return finalUrlRoot;
}

let blacklist = [];
async function generateBlacklist() {
    blacklist = ["busann"];
}

function checkModuleUpdateUrlBlacklist(update_url_root) {
    // TODO: ... resolve this issue ...
    return !blacklist.some(name => update_url_root.toLowerCase().includes(`/${name}/`));
}

function reportProgress(callback, progress) {
    // Observation must never turn a UI error into an update failure or retry.
    if (typeof callback === 'function') {
        try { callback(progress); } catch (_) {}
    }
}

async function autoUpdateModule(name, root, updateData, updatelog, updatelimit, serverIndex = 0, onProgress) {
    let active = true;
    let filesCompleted = 0, filesTotal = 0;
    const reportFile = file => {
        if (active) reportProgress(onProgress, { file, filesCompleted, filesTotal });
    };
    reportFile('');
    try {
        // If only one file (module.json) exists, it's a fresh install
        if (walkdir(root, true, false).length === 1)
            console.log(mui.get('update/start-module-install', { name }));
        else if (updatelog)
            console.log(mui.get('update/start-module-update', { name }));

        if (!updateData.servers || updateData.servers.length === 0) {
            console.warn(mui.get('update/warning-module-no-update-servers', { name }));
            return { results: [] };
        }

        const update_url_root = migrateModuleUpdateUrlRoot(updateData.servers[serverIndex]);
        if (!update_url_root || !checkModuleUpdateUrlBlacklist(update_url_root))
            return { results: [] };

        const manifest_file = 'manifest.json';
        const manifest_url = update_url_root + manifest_file;
        const manifest_path = path.join(root, manifest_file);
        if (updatelog)
            console.log(mui.get('update/module-download-manifest', { serverIndex }));

        let manifest_result = await autoUpdateFile(manifest_file, manifest_path, manifest_url, updateData["drmKey"], null, "json");
        if (!manifest_result[1])
            throw new Error(`Unable to download update manifest for module "${name}":\n${manifest_result[2]}`);

        let manifest;
        try {
            manifest = JSON.parse(fs.readFileSync(manifest_path, 'utf8'));
        } catch (e) {
            throw new Error(`Invalid update manifest for module "${name}":\n${e}`);
        }

        let promises = [];
        filesTotal = Object.keys(manifest.files || {}).length;
        reportFile('');
        for (let file in manifest.files) {
            reportFile(file);
            let filepath = path.join(root, file);
            let filedata = manifest.files[file];

            // Check if the file needs to be updated
            let needsUpdate = !fs.existsSync(filepath);
            let expectedHash = null;
            if (!needsUpdate) {
                if (typeof filedata === 'object') {
                    expectedHash = filedata.hash.toUpperCase();
                    needsUpdate = filedata.overwrite && (hash(fs.readFileSync(filepath)) !== expectedHash);
                } else {
                    expectedHash = filedata.toUpperCase();
                    needsUpdate = (hash(fs.readFileSync(filepath)) !== expectedHash);
                }
            }

            // Update file if required
            if (needsUpdate) {
                const file_url = update_url_root + file;
                if (updatelog)
                    console.log(mui.get('update/module-download-file', { file }));

                let promise = autoUpdateFile(file, filepath, file_url, updateData.drmKey, manifest.no_hash_verification ? null : expectedHash).then(result => {
                    filesCompleted++;
                    reportFile(file);
                    return result;
                });
                promises.push(updatelimit ? (await promise) : promise);
            } else {
                filesCompleted++;
                reportFile(file);
            }
        }

        return { results: updatelimit ? promises : (await Promise.all(promises)) };
    } catch (e) {
        active = false;
        if (serverIndex + 1 < updateData.servers.length)
            return autoUpdateModule(name, root, updateData, updatelog, updatelimit, serverIndex + 1, onProgress);
        else
            return Promise.reject(e);
    } finally {
        active = false;
    }
}

async function autoUpdate(moduleBase, updatelog, updatelimit, onProgress) {
    console.log(mui.get('update/started'));
    forcedirSync(moduleBase);
    await generateBlacklist();

    let successModules = [];
    let legacyModules = [];
    let failedModules = [];

    // Keep one entry per module even when dependencies or module.json trigger another pass.
    const progressModules = new Map();
    let currentKey = '', current = '';
    let fileProgress = { file: '', filesCompleted: 0, filesTotal: 0 };
    const report = () => {
        if (typeof onProgress !== 'function') return;
        const statuses = Array.from(progressModules.values());
        const total = statuses.length, completed = statuses.filter(Boolean).length;
        const fraction = progressModules.get(currentKey) === null && fileProgress.filesTotal ? fileProgress.filesCompleted / fileProgress.filesTotal : 0;
        reportProgress(onProgress, { total, completed,
            failed: statuses.filter(value => value === 'failed').length,
            skipped: statuses.filter(value => value === 'skipped').length,
            current: current.slice(0, 200), ...fileProgress,
            fraction: total ? (completed + fraction) / total : 0 });
    };
    const discover = names => {
        names.forEach(name => { const key = name.toLowerCase(); if (!progressModules.has(key)) progressModules.set(key, null); });
        report();
    };
    const begin = (name, displayName = name) => {
        currentKey = name.toLowerCase(); current = String(displayName);
        fileProgress = { file: '', filesCompleted: 0, filesTotal: 0 };
        report();
    };
    const finish = (name, status) => { progressModules.set(name.toLowerCase(), status); report(); };

    let installedModulesChanged;
    do {
        installedModulesChanged = false;
        let addedModules = [];
        const installedModuleInfos = listModuleInfos(moduleBase);
        discover([...installedModuleInfos.map(mod => mod.name), ...Object.keys(CoreModules)]);

        for (let coreModule in CoreModules) {
            if (!installedModuleInfos.some(mod => mod.name === coreModule.toLowerCase()) && addedModules.indexOf(coreModule) < 0) {
                begin(coreModule);
                const coreModuleResult = await autoUpdateFile('module.json', path.join(moduleBase, coreModule, 'module.json'), CoreModules[coreModule]);
                if (!coreModuleResult[1]) {
                    finish(coreModule, 'failed');
                    throw new Error(`Unable to install core module "${coreModule}: ${coreModuleResult[2]}`);
                }
                console.log(mui.get('update/core-module-initialized', { coreModule }));
                installedModulesChanged = true;
                addedModules.push(coreModule);
            }
        }

        for (let moduleInfo of installedModuleInfos) {
            begin(moduleInfo.name, moduleInfo.rawName);
            // If the module isn't auto-update compatible, skip it
            if (moduleInfo.compatibility !== 'compatible') {
                legacyModules.push({
                    name: moduleInfo.rawName
                });
                finish(moduleInfo.name, 'skipped');

                continue;
            }

            let moduleConfigChanged;
            do {
                moduleConfigChanged = false;
                let updateData = JSON.parse(fs.readFileSync(path.join(moduleInfo.path, 'module.json'), 'utf8'));

                for (let dependency in updateData["dependencies"]) {
                    // Temporary workaround for migration phase
                    if (dependency === 'tera-game-state-helper')
                        continue;

                    if (!installedModuleInfos.some(mod => mod.name === dependency.toLowerCase()) && addedModules.indexOf(dependency) < 0) {
                        discover([dependency]);
                        begin(dependency);
                        const dependency_result = await autoUpdateFile('module.json', path.join(moduleBase, dependency, 'module.json'), updateData["dependencies"][dependency]);
                        if (!dependency_result[1]) {
                            finish(dependency, 'failed');
                            throw new Error(`Unable to install dependency module "${dependency}: ${dependency_result[2]}`);
                        }
                        console.log(mui.get('update/dependency-module-initialized', { dependency, name: moduleInfo.rawName }));
                        installedModulesChanged = true;
                        addedModules.push(dependency);
                        begin(moduleInfo.name, moduleInfo.rawName);
                    }
                }

                // Check if auto-update is disabled or if only one file (module.json) exists, then it's a fresh install
                const isFreshInstalled = walkdir(moduleInfo.path, true, false).length === 1;
                if (!isFreshInstalled && moduleInfo.disableAutoUpdate) {
                    console.warn(mui.get('update/warning-module-update-disabled', { name: moduleInfo.rawName }));
                    successModules.push({
                        name: moduleInfo.rawName
                    });
                    finish(moduleInfo.name, 'skipped');

                    continue;
                }

                // Auto-update enabled or fresh install
                try {
                    const moduleConfig = await autoUpdateModule(moduleInfo.rawName, moduleInfo.path, updateData, updatelog, updatelimit, 0, progress => {
                        fileProgress = { ...progress, file: progress.file.slice(0, 200) };
                        report();
                    });

                    let failedFiles = [];
                    for (let result of moduleConfig["results"]) {
                        if (!result[1]) {
                            failedFiles.push(result[0]);
                            failedFiles.push(result[2]);
                        } else {
                            if (result[0] === "module.json") {
                                moduleConfigChanged = true;
                                if (updatelog)
                                    console.log(mui.get('update/module-config-changed'));
                            }
                        }
                    }

                    if (!moduleConfigChanged) {
                        if (failedFiles.length > 0)
                            throw `Failed to update the following module files:\n - ${ failedFiles.join("\n - ")}`;

                        successModules.push({
                            name: moduleInfo.rawName
                        });
                        finish(moduleInfo.name, 'done');
                    }
                } catch (e) {
                    console.error(mui.get('update/module-update-failed-1', { name: moduleInfo.rawName }));
                    console.error(e);
                    if (updateData.supportUrl) {
                        console.error(mui.get('update/module-update-failed-2-1', { supportUrl: updateData.supportUrl }));
                        if (updateData.supportUrl !== global.TeraProxy.DiscordUrl)
                            console.error(mui.get('update/module-update-failed-2-2', { supportUrl: global.TeraProxy.SupportUrl }));
                    } else {
                        console.error(mui.get('update/module-update-failed-3', { supportUrl: global.TeraProxy.SupportUrl }));
                    }

                    failedModules.push({
                        name: moduleInfo.rawName
                    });
                    finish(moduleInfo.name, 'failed');
                }
            } while (moduleConfigChanged);
        }
    } while (installedModulesChanged);

    console.log(mui.get('update/finished'));
    return { "updated": successModules, "legacy": legacyModules, "failed": failedModules };
}

module.exports = autoUpdate;
