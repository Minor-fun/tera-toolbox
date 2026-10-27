const mui = require('tera-toolbox-mui').DefaultInstance;
const Mod = require('./mod');
const { isCoreModule, listModules, loadModuleInfo } = require('tera-mod-management');

function printableName(info) {
    if (info.options.cliName && info.options.cliName !== info.name)
        return `"${info.options.cliName}" (${info.rawName})`;
    return `"${info.rawName}"`;
}

// Runtime mod manager
class ModManager {
    constructor(rootFolder) {
        this.rootFolder = rootFolder;
        this.installedMods = new Map;
        this.loadedMods = new Map;
    }

    destructor() {
        this.unloadAll();
    }

    isInstalled(name) {
        return this.installedMods.has(name.toLowerCase());
    }

    getInfo(name) {
        return this.installedMods.get(name.toLowerCase());
    }

    isLoaded(name) {
        return this.loadedMods.has(name.toLowerCase());
    }

    get(name) {
        return this.loadedMods.get(name.toLowerCase());
    }

    isCoreMod(name) {
        const info = this.getInfo(name.toLowerCase());
        return info && isCoreModule(info);
    }

    // Mods & Global mod instances
    loadAll(onProgress) {
        // List installed modules
        this.installedMods.clear();
        listModules(this.rootFolder).forEach(name => {
            // Safely load mod info
            let info;
            try {
                info = loadModuleInfo(this.rootFolder, name);
            } catch (e) {
                console.error(mui.get('mod-manager/load-module-info-error', { name }));
                console.error(e);
                return;
            }

            if (!info.disabled) {
                if (this.installedMods.has(info.name))
                    console.error(mui.get('mod-manager/duplicate-mod-error', { name }));
                else
                    this.installedMods.set(info.name, info);
            }
        });

        // Observe this preload pass only, including loads triggered recursively by dependencies.
        this.preloadProgress = typeof onProgress === 'function' ? {
            notify: onProgress, pending: new Set(this.installedMods.keys()),
            total: this.installedMods.size, completed: 0, loaded: 0, failed: 0, skipped: 0
        } : null;
        this.reportPreload();
        try {
            // Check dependencies and conflicts
            let ModRemoved;
            do {
                ModRemoved = false;

                this.installedMods.forEach((info, name) => {
                    info.dependencies.forEach(dependency => {
                        if (!this.isInstalled(dependency)) {
                            console.error(mui.get('mod-manager/missing-mod-dependency-error', { name: printableName(info), dependency }));
                            this.installedMods.delete(name);
                            this.finishPreload(info, 'skipped');
                            ModRemoved = true;
                        }
                    });
                });

                this.installedMods.forEach((info, name) => {
                    info.conflicts.forEach(conflict => {
                        if (this.isInstalled(conflict)) {
                            console.error(mui.get('mod-manager/mod-conflict-error', { name: printableName(info), conflict }));
                            this.installedMods.delete(name);
                            this.finishPreload(info, 'skipped');
                            ModRemoved = true;
                        }
                    });
                });
            } while (ModRemoved);

            // Load core mods first
            this.installedMods.forEach(mod => {
                if (this.isLoaded(mod.name)) this.finishPreload(mod, 'loaded');
                if (this.isCoreMod(mod.name) && !this.isLoaded(mod.name))
                    this.load(mod.name);
            });

            // Then load other mods
            this.installedMods.forEach(mod => {
                if (!this.isCoreMod(mod.name) && !this.isLoaded(mod.name))
                    this.load(mod.name);
            });
        } finally {
            this.preloadProgress = null;
        }
    }

    reportPreload(info) {
        const progress = this.preloadProgress;
        if (!progress) return;
        const { total, completed, loaded, failed, skipped } = progress;
        const current = info ? String(info.options.guiName || info.options.cliName || info.rawName || info.name).slice(0, 200) : '';
        // Progress is advisory; a disconnected UI must not change module loading behavior.
        try { progress.notify({ total, completed, loaded, failed, skipped, current }); } catch (_) {}
    }

    finishPreload(info, result) {
        const progress = this.preloadProgress;
        if (!progress || !progress.pending.delete(info.name)) return;
        progress.completed++;
        progress[result]++;
        this.reportPreload(info);
    }

    unloadAll() {
        // Unload non-core mods first
        this.loadedMods.forEach(mod => {
            if (!this.isCoreMod(mod.info.name))
                this.unload(mod.info.name);
        });

        // Then unload remaining (core) modules
        this.loadedMods.forEach(mod => this.unload(mod.info.name));
    }

    load(name, logInfo = true) {
        let mod = this.get(name);
        if (mod)
            return mod;

        const info = this.getInfo(name);
        if (!info) {
            if (logInfo)
                console.error(mui.get('mod-manager/cannot-load-mod-not-installed', { name }));
        } else {
            this.reportPreload(info);
            let preloaded = false;
            try {
                mod = new Mod(this, info);
                if (!mod.loadCache())
                    return null;
                preloaded = true;
                this.loadedMods.set(info.name, mod);
                mod.loadGlobalInstance(logInfo);
            } finally {
                this.finishPreload(info, preloaded ? 'loaded' : 'failed');
            }
        }

        return mod;
    }

    unload(name, logInfo = true) {
        const info = this.getInfo(name);
        if (!info) {
            console.error(mui.get('mod-manager/cannot-unload-mod-not-installed', { name }));
            return false;
        }

        let mod = this.get(info.name);
        if (!mod) {
            console.error(mui.get('mod-manager/cannot-unload-mod-not-loaded', { name: printableName(info) }));
            return false;
        }

        mod.destructor(logInfo);
        mod = null;
        this.loadedMods.delete(info.name);
        return true;
    }

    reload(name, logInfo = true) {
        const info = this.getInfo(name);
        if (!info) {
            console.error(mui.get('mod-manager/cannot-reload-mod-not-installed', { name }));
            return false;
        }
        if (!info.options.reloadable) {
            console.error(mui.get('mod-manager/cannot-reload-mod-not-supported', { name: printableName(info) }));
            return false;
        }

        let mod = this.get(info.name);
        if (!mod) {
            console.error(mui.get('mod-manager/cannot-reload-mod-not-loaded', { name: printableName(info) }));
            return false;
        }

        return mod.reload(logInfo);
    }

    // Client mod instances
    loadAllClient(clientInterface) {
        // Load core mods first
        this.loadedMods.forEach(mod => {
            if (this.isCoreMod(mod.info.name))
                this.loadClient(mod, clientInterface);
        });

        // Then load other mods
        this.loadedMods.forEach(mod => {
            if (!this.isCoreMod(mod.info.name))
                this.loadClient(mod, clientInterface);
        });
    }

    unloadAllClient(clientInterface) {
        // Unload non-core mods first
        this.loadedMods.forEach(mod => {
            if (!this.isCoreMod(mod.info.name))
                this.unloadClient(mod, clientInterface);
        });

        // Then unload core modules
        this.loadedMods.forEach(mod => {
            if (this.isCoreMod(mod.info.name))
                this.unloadClient(mod, clientInterface);
        });
    }

    async _installAllClient(clientInterface) {
        for (let mod of this.loadedMods.values()) {
            let clientInstance = mod.getClientInstance(clientInterface);
            if (clientInstance)
                await clientInstance._install();
        }
    }

    loadClient(mod, clientInterface, logInfo = true) {
        return mod.loadClientInstance(clientInterface, logInfo);
    }

    unloadClient(mod, clientInterface, logInfo = true) {
        return mod.unloadClientInstance(clientInterface, logInfo);
    }

    // Network mod instances
    loadAllNetwork(dispatch) {
        // Load core mods first
        this.loadedMods.forEach(mod => {
            if (this.isCoreMod(mod.info.name))
                this.loadNetwork(mod, dispatch);
        });

        // Then load other mods
        this.loadedMods.forEach(mod => {
            if (!this.isCoreMod(mod.info.name))
                this.loadNetwork(mod, dispatch);
        });
    }

    unloadAllNetwork(dispatch) {
        // Unload non-core mods first
        this.loadedMods.forEach(mod => {
            if (!this.isCoreMod(mod.info.name))
                this.unloadNetwork(mod, dispatch);
        });

        // Then unload core modules
        this.loadedMods.forEach(mod => {
            if (this.isCoreMod(mod.info.name))
                this.unloadNetwork(mod, dispatch);
        });
    }

    loadNetwork(mod, dispatch, logInfo = true) {
        return mod.loadNetworkInstance(dispatch, logInfo);
    }

    unloadNetwork(mod, dispatch, logInfo = true) {
        return mod.unloadNetworkInstance(dispatch, logInfo);
    }
}

module.exports = ModManager;
