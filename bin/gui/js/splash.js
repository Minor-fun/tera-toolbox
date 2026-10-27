const { ipcRenderer } = require("electron");
const { TeraToolboxMUI } = require("tera-toolbox-mui");
const { translator, languageFromArguments, htmlLanguage } = require("./ui-i18n");
const language = languageFromArguments(process.argv);
const t = translator(language, TeraToolboxMUI);
document.documentElement.lang = htmlLanguage(language);

document.addEventListener("DOMContentLoaded", () => {
	// --------------------------------------------------------------------
	// ----------------------------- MAIN ---------------------------------
	// --------------------------------------------------------------------
	// Disable mouse wheel clicks

	const captionElem = document.getElementById("caption");
	const infoElem = document.getElementById("info");
	captionElem.textContent = t("splashInitializing");

	document.addEventListener("auxclick", (e) => {
		if (e.which !== 2)
			return true;

		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
		return false;
	});

	// Status display
	ipcRenderer.on("caption", (_, caption) => {
		captionElem.textContent = caption;
	});
	ipcRenderer.on("info", (_, info) => {
		infoElem.textContent = info;
	});
});
