"use strict";

const fs = require("fs");
const ut = require("./util");

const BLACKLIST_FILE_PREFIXES = [
	...ut.FILE_PREFIX_BLACKLIST,

	// specific files
	"demo.json"
];

const TAGS_TO_CHECK = new Set([
	"spell",
	"item",
	"creature",
	"condition",
	"disease",
	"background",
	"race",
	"optfeature",
	"reward",
	"feat",
	"psionic",
	"object",
	"cult",
	"boon",
	"trap",
	"hazard",
	"variantrule",
	"ship"
]);

const files = ut.listFiles({dir: `./data`, blacklistFilePrefixes: BLACKLIST_FILE_PREFIXES});
files.forEach(f => {
	const compressedTags = fs.readFileSync(f, "utf-8").replace(/{@([a-zA-Z]+) ([^|}]+)\|([^|}]*)\|([^|}]+)}/g, (...m) => {
		const [all, tag, ref, src, txt] = m;
		if (!TAGS_TO_CHECK.has(tag.toLowerCase())) return all;
		if (ref.toLowerCase() === txt.toLowerCase()) {
			if (!src || ut.TAG_TO_DEFAULT_SOURCE[tag.toLowerCase()] === src.toLowerCase()) {
				return `{@${tag} ${txt}${src ? `|${src}` : ""}}`;
			}
		}
		return all;
	});

	const compressedSources = compressedTags.replace(/{@([a-zA-Z]+) ([^|}]+)\|([^|}]+)\|([^|}]+)}/g, (...m) => {
		const [all, tag, ref, src, txt] = m;
		if (!TAGS_TO_CHECK.has(tag.toLowerCase())) return all;
		if (ut.TAG_TO_DEFAULT_SOURCE[tag.toLowerCase()] === src.toLowerCase()) {
			return `{@${tag} ${ref}||${txt}}`;
		}
		return all;
	});

	const skippedDefaultSources = compressedSources.replace(/{@([a-zA-Z]+) ([^|}]+)\|([^|}]+)}/g, (...m) => {
		const [all, tag, ref, src] = m;
		if (!TAGS_TO_CHECK.has(tag.toLowerCase())) return all;
		if (ut.TAG_TO_DEFAULT_SOURCE[tag.toLowerCase()] === src.toLowerCase()) {
			return `{@${tag} ${ref}}`;
		}
		return all;
	});

	const out = ut.getCleanStringJson(skippedDefaultSources);
	fs.writeFileSync(f, JSON.parse(out), "utf-8");
});
