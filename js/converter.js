"use strict";

window.onload = doPageInit;

String.prototype.split_handleColon = String.prototype.split_handleColon ||
	function (str, maxSplits = Number.MAX_SAFE_INTEGER) {
		if (str === "") return this.split("");

		const colonStr = `${str.trim()}:`;
		const isColon = this.toLowerCase().startsWith(colonStr.toLowerCase());

		const re = isColon ? new RegExp(colonStr, "ig") : new RegExp(str, "ig");
		const targetString = isColon ? colonStr : str;

		let m = re.exec(this);
		let splits = 0;
		const out = [];
		const indexes = [];

		while (m && splits < maxSplits) {
			indexes.push(m.index);

			splits++;
			m = re.exec(this);
		}

		if (indexes.length === 1) {
			out.push(this.substring(0, indexes[0]));
			out.push(this.substring(indexes[0] + targetString.length, this.length));
		} else {
			for (let i = 0; i < indexes.length - 1; ++i) {
				const start = indexes[i];

				if (i === 0) {
					out.push(this.substring(0, start));
				}

				const end = indexes[i + 1];
				out.push(this.substring(start + targetString.length, end));

				if (i === indexes.length - 2) {
					out.push(this.substring(end + targetString.length, this.length))
				}
			}
		}

		return out.map(it => it.trim());
	};

String.prototype.indexOf_handleColon = String.prototype.indexOf_handleColon ||
	function (str) {
		const colonStr = `${str.trim()}:`;
		const idxColon = this.toLowerCase().indexOf(colonStr.toLowerCase());
		if (~idxColon) return idxColon;
		return this.toLowerCase().indexOf(str.toLowerCase());
	};

class ConverterUi {
	constructor () {
		this._editorIn = null;
		this._editorOut = null;
		this._hasAppended = false;

		this._statblockConverter = null;
		this._tableConverter = null;

		this._menuAccess = null;

		this._saveInputDebounced = MiscUtil.debounce(() => StorageUtil.pSetForPage(ConverterUi.STORAGE_INPUT, this._editorIn.getValue()), 50);

		this._storedSettings = StorageUtil.syncGetForPage(ConverterUi.STORAGE_SETTINGS) || {};
		this._saveSettingsDebounced = MiscUtil.debounce(() => StorageUtil.syncSetForPage(ConverterUi.STORAGE_SETTINGS, this._storedSettings), 50);

		this._$selSource = null;
	}

	set statblockConverter (statblockConverter) { this._statblockConverter = statblockConverter; }

	set tableConverter (tableConverter) { this._tableConverter = tableConverter; }

	async init () {
		this._editorIn = ace.edit("converter_input");
		this._editorIn.setOptions({
			wrap: true,
			showPrintMargin: false
		});
		try {
			const prevInput = await StorageUtil.pGetForPage(ConverterUi.STORAGE_INPUT);
			if (prevInput) this._editorIn.setValue(prevInput, -1);
		} catch (ignored) { setTimeout(() => { throw ignored; }) }
		this._editorIn.on("change", () => this._saveInputDebounced());

		this._editorOut = ace.edit("converter_output");
		this._editorOut.setOptions({
			wrap: true,
			showPrintMargin: false,
			readOnly: true
		});

		$(`#editable`).click(() => {
			if (confirm(`Edits will be overwritten as you parse new statblocks. Enable anyway?`)) this.outReadOnly = false;
		});

		$(`#save_local`).click(async () => {
			const output = this.outText;
			if (output && output.trim()) {
				try {
					const prop = this._storedSettings.parser === "Statblock" ? "monster" : "table";
					const entries = JSON.parse(`[${output}]`);

					const invalidSources = entries.map(it => !it.source || !BrewUtil.hasSourceJson(it.source) ? (it.name || it.caption || "(Unnamed)").trim() : false).filter(Boolean);
					if (invalidSources.length) {
						JqueryUtil.doToast({
							content: `One or more entries have missing or unknown sources: ${invalidSources.join(", ")}`,
							type: "danger"
						});
						return;
					}

					// ignore duplicates
					const _dupes = {};
					const dupes = [];
					const dedupedEntries = entries.map(it => {
						const lSource = it.source.toLowerCase();
						const lName = it.name.toLowerCase();
						_dupes[lSource] = _dupes[lSource] || {};
						if (_dupes[lSource][lName]) {
							dupes.push(it.name);
							return null;
						} else {
							_dupes[lSource][lName] = true;
							return it;
						}
					}).filter(Boolean);
					if (dupes.length) {
						JqueryUtil.doToast({
							type: "warning",
							content: `Ignored ${dupes.length} duplicate entr${dupes.length === 1 ? "y" : "ies"}`
						})
					}

					// handle overwrites
					const overwriteMeta = dedupedEntries.map(it => {
						const ix = (BrewUtil.homebrew[prop] || []).findIndex(bru => bru.name.toLowerCase() === it.name.toLowerCase() && bru.source.toLowerCase() === it.source.toLowerCase());
						if (~ix) {
							return {
								isOverwrite: true,
								ix,
								entry: it
							}
						} else return {entry: it, isOverwrite: false};
					}).filter(Boolean);
					const willOverwrite = overwriteMeta.map(it => it.isOverwrite).filter(Boolean);
					if (willOverwrite.length && !confirm(`This will overwrite ${willOverwrite.length} entr${willOverwrite.length === 1 ? "y" : "ies"}. Are you sure?`)) {
						return;
					}

					await Promise.all(overwriteMeta.map(meta => {
						if (meta.isOverwrite) {
							return BrewUtil.pUpdateEntryByIx(prop, meta.ix, MiscUtil.copy(meta.entry));
						} else {
							return BrewUtil.pAddEntry(prop, MiscUtil.copy(meta.entry));
						}
					}));

					JqueryUtil.doToast({
						type: "success",
						content: `Saved!`
					});

					Omnisearch.pAddToIndex("monster", overwriteMeta.filter(meta => !meta.isOverwrite).map(meta => meta.entry));
				} catch (e) {
					JqueryUtil.doToast({
						content: `Current output was not valid JSON!`,
						type: "danger"
					});
					setTimeout(() => { throw e });
				}
			} else {
				JqueryUtil.doToast({
					content: "Nothing to save!",
					type: "danger"
				});
			}
		});

		$(`#download`).click(() => {
			const output = this.outText;
			if (output && output.trim()) {
				try {
					const prop = this._storedSettings.parser === "Statblock" ? "monster" : "table";
					const out = {[prop]: JSON.parse(`[${output}]`)};
					DataUtil.userDownload(`converter-output`, out);
				} catch (e) {
					JqueryUtil.doToast({
						content: `Current output was not valid JSON. Downloading as <span class="code">.txt</span> instead.`,
						type: "warning"
					});
					DataUtil.userDownloadText(`converter-output.txt`, output);
					setTimeout(() => { throw e; });
				}
			} else {
				JqueryUtil.doToast({
					content: "Nothing to download!",
					type: "danger"
				});
			}
		});

		/**
		 * Wrap a function in an error handler which will wipe the error output, and append future errors to it.
		 * @param toRun
		 */
		const catchErrors = (toRun) => {
			try {
				$(`#lastWarnings`).hide().html("");
				$(`#lastError`).hide().html("");
				this._editorOut.resize();
				toRun();
			} catch (x) {
				const splitStack = x.stack.split("\n");
				const atPos = splitStack.length > 1 ? splitStack[1].trim() : "(Unknown location)";
				const message = `[Error] ${x.message} ${atPos}`;
				$(`#lastError`).show().html(message);
				this._editorOut.resize();
				setTimeout(() => { throw x });
			}
		};

		$("#parsestatblock").on("click", () => {
			catchErrors(() => {
				if (!this._hasAppended || confirm("You're about to overwrite multiple entries. Are you sure?")) {
					this._menuAccess.handleParse();
				}
			});
		});

		$(`#parsestatblockadd`).on("click", () => {
			catchErrors(() => this._menuAccess.handleParseAndAdd());
		});

		this.initSideMenu();
	}

	initSideMenu () {
		const $mnu = $(`.sidemenu`);
		const renderDivider = ($menu, heavy) => $menu.append(`<hr class="sidemenu__row__divider ${heavy ? "sidemenu__row__divider--heavy" : ""}">`);

		const prevParser = this._storedSettings.parser;

		const $wrpParser = $(`<div class="sidemenu__row split-v-center"><div class="sidemenu__row__label">Mode</div></div>`).appendTo($mnu);
		const $selParser = $(`
			<select class="form-control input-sm">
				<option>Statblock</option>
				<option>Table</option>
			</select>
		`).appendTo($wrpParser).change(() => {
			this._storedSettings.parser = $selParser.val();
			this._saveSettingsDebounced();
			switch ($selParser.val()) {
				case "Statblock": renderStatblockSidemenu(); break;
				case "Table": renderTableSidemenu(); break;
			}
		});

		renderDivider($mnu, true);
		const $wrpCustom = $(`<div/>`).appendTo($mnu);

		const renderStatblockSidemenu = () => {
			$(`#save_local`).show();
			this._menuAccess = {};

			$wrpCustom.empty();
			$(`<div class="sidemenu__row split-v-center">
				<small>This parser is <span class="help" title="Notably poor at handling text split across multiple lines, as Carriage Return is used to separate blocks of text.">very particular</span> about its input. Use at your own risk.</small>
			</div>`).appendTo($wrpCustom);

			renderDivider($wrpCustom);

			const $wrpMode = $(`<div class="sidemenu__row flex-vh-center-around"/>`).appendTo($wrpCustom);
			const $selMode = $(`
					<select class="form-control input-sm select-inline">
							<option value="txt">Parse as Text</option>
							<option value="md" selected>Parse as Markdown</option>
					</select>
				`)
				.appendTo($wrpMode)
				.change(() => {
					this._storedSettings.statblockMode = $selMode.val();
					this._saveSettingsDebounced();
				});
			const prevMode = this._storedSettings.statblockMode;
			if (prevMode) $selMode.val(prevMode);

			const $wrpTitle = $(`<div class="sidemenu__row split-v-center"><label class="sidemenu__row__label sidemenu__row__label--cb-label" title="Should the creature's name be converted to title-case? Useful when pasting a name which is all-caps."><span>Title-Case Name</span></label></div>`).appendTo($wrpCustom);
			const $cbTitleCase = $(`<input type="checkbox" class="sidemenu__row__label__cb">`)
				.change(() => {
					this._storedSettings.statblockTitleCase = $cbTitleCase.prop("checked");
					this._saveSettingsDebounced();
				})
				.appendTo($wrpTitle.find(`label`))
				.prop("checked", !!this._storedSettings.statblockTitleCase);
			this._menuAccess.isTitleCase = () => !!$cbTitleCase.prop("checked");

			renderDivider($wrpCustom);

			const $wrpPage = $(`<div class="sidemenu__row split-v-center"><div class="sidemenu__row__label">Page</div></div>`).appendTo($wrpCustom);
			const $iptPage = $(`<input class="form-control input-sm" type="number" style="max-width: 9rem;">`)
				.change(() => {
					this._storedSettings.statblockPage = $iptPage.val();
					this._saveSettingsDebounced();
				})
				.appendTo($wrpPage)
				.val(this._storedSettings.statblockPage || "0");
			this._menuAccess.getPage = () => Number($iptPage.val());

			renderDivider($wrpCustom);

			const $wrpSource = $(`<div class="sidemenu__row split-v-center"><div class="sidemenu__row__label">Source</div></div>`).appendTo($wrpCustom);
			this._menuAccess.getSource = () => this._$selSource.val();

			const $wrpSourceOverlay = $(`<div class="full-height full-width"/>`);
			let $sourceModal = null;

			const rebuildStageSource = (options) => {
				SourceUiUtil.render({
					...options,
					$parent: $wrpSourceOverlay,
					cbConfirm: (source) => {
						const isNewSource = options.mode !== "edit";

						if (isNewSource) BrewUtil.addSource(source);
						else BrewUtil.updateSource(source);

						if (isNewSource) this._$selSource.append(`<option value="${source.json.escapeQuotes()}">${source.full.escapeQuotes()}</option>`);
						this._$selSource.val(source.json);
						if ($sourceModal) $sourceModal.data("close")();
					},
					cbConfirmExisting: (source) => {
						this._$selSource.val(source.json);
						if ($sourceModal) $sourceModal.data("close")();
					},
					cbCancel: () => {
						if ($sourceModal) $sourceModal.data("close")();
					}
				});
			};

			this._allSources = (BrewUtil.homebrewMeta.sources || []).sort((a, b) => SortUtil.ascSortLower(a.full, b.full))
				.map(it => it.json);
			this._$selSource = $$`
			<select class="form-control input-sm">
				<option value="">(None)</option>
				${this._allSources.map(s => `<option value="${s.escapeQuotes()}">${Parser.sourceJsonToFull(s).escapeQuotes()}</option>`)}
			</select>`
				.appendTo($wrpSource)
				.change(() => {
					if (this._$selSource.val()) this._storedSettings.sourceJson = this._$selSource.val();
					else delete this._storedSettings.sourceJson;
					this._saveSettingsDebounced();
				});
			if (this._storedSettings.sourceJson) this._$selSource.val(this._storedSettings.sourceJson);
			else this._$selSource[0].selectedIndex = 0;

			const $btnSourceEdit = $(`<button class="btn btn-default btn-sm mr-2">Edit Selected Source</button>`)
				.click(() => {
					const curSourceJson = this._storedSettings.sourceJson;
					if (!curSourceJson) {
						JqueryUtil.doToast({type: "warning", content: "No source selected!"});
						return;
					}

					const curSource = BrewUtil.sourceJsonToSource(curSourceJson);
					if (!curSource) return;
					rebuildStageSource({mode: "edit", source: MiscUtil.copy(curSource)});
					$sourceModal = UiUtil.getShow$Modal({
						fullHeight: true,
						fullWidth: true,
						cbClose: () => $wrpSourceOverlay.detach()
					});
					$wrpSourceOverlay.appendTo($sourceModal);
				});
			$$`<div class="sidemenu__row">${$btnSourceEdit}</div>`.appendTo($wrpCustom);

			const $btnSourceAdd = $(`<button class="btn btn-default btn-sm">Add New Source</button>`).click(() => {
				rebuildStageSource({mode: "add"});
				$sourceModal = UiUtil.getShow$Modal({
					fullHeight: true,
					fullWidth: true,
					cbClose: () => $wrpSourceOverlay.detach()
				});
				$wrpSourceOverlay.appendTo($sourceModal);
			});
			$$`<div class="sidemenu__row">${$btnSourceAdd}</div>`.appendTo($wrpCustom);

			renderDivider($wrpCustom);

			const $wrpSample = $(`<div class="sidemenu__row flex-vh-center-around"/>`).appendTo($wrpCustom);
			$(`<button class="btn btn-sm btn-default">Sample Text</button>`)
				.appendTo($wrpSample).click(() => {
					this.inText = statblockConverter.getSample("txt");
					$selMode.val("txt").change();
				});
			$(`<button class="btn btn-sm btn-default">Sample Markdown</button>`)
				.appendTo($wrpSample).click(() => {
					this.inText = statblockConverter.getSample("md");
					$selMode.val("md").change();
				});

			const _getStatblockParseOptions = (isAppend) => ({
				cbWarning: this.showWarning.bind(this),
				cbOutput: (stats, append) => {
					this.doCleanAndOutput(stats, append);
				},
				source: this.source,
				pageNumber: this.pageNumber,
				isAppend,
				isTitleCaseName: this.menuAccess.isTitleCase()
			});

			this._menuAccess.handleParse = () => {
				const opts = _getStatblockParseOptions(false);
				$selMode.val() === "txt" ? this._statblockConverter.doParseText(this.inText, opts) : this._statblockConverter.doParseMarkdown(this.inText, opts);
			};

			this._menuAccess.handleParseAndAdd = () => {
				const opts = _getStatblockParseOptions(true);
				$selMode.val() === "txt" ? this._statblockConverter.doParseText(this.inText, opts) : this._statblockConverter.doParseMarkdown(this.inText, opts);
			};
		};

		const renderTableSidemenu = () => {
			$(`#save_local`).hide();
			this._menuAccess = {};

			$wrpCustom.empty();

			const $wrpMode = $(`<div class="sidemenu__row flex-vh-center-around"/>`).appendTo($wrpCustom);
			const $selMode = $(`
					<select class="form-control input-sm select-inline">
							<option value="html" selected>Parse as HTML</option>
							<option value="md">Parse as Markdown</option>
					</select>
				`)
				.appendTo($wrpMode)
				.change(() => {
					this._storedSettings.tableMode = $selMode.val();
					this._saveSettingsDebounced();
				});
			const prevMode = this._storedSettings.tableMode;
			if (prevMode) $selMode.val(prevMode);

			renderDivider($wrpCustom);

			const $wrpSample = $(`<div class="sidemenu__row split-v-center"/>`).appendTo($wrpCustom);

			$(`<button class="btn btn-sm btn-default">Sample HTML</button>`)
				.appendTo($wrpSample).click(() => {
					this.inText = tableConverter.showSample("html");
					$selMode.val("html").change();
				});
			$(`<button class="btn btn-sm btn-default">Sample Markdown</button>`)
				.appendTo($wrpSample).click(() => {
					this.inText = tableConverter.showSample("md");
					$selMode.val("md").change();
				});

			const _getTableParseOptions = (isAppend) => ({
				cbWarning: this.showWarning.bind(this),
				cbOutput: (table, append) => {
					this.doCleanAndOutput(table, append);
				},
				isAppend
			});

			this._menuAccess.handleParse = () => {
				const opts = _getTableParseOptions(false);
				if ($selMode.val() === "html") this._tableConverter.doParseHtml(this.inText, opts);
				else this._tableConverter.doParseMarkdown(this.inText, opts);
			};

			this._menuAccess.handleParseAndAdd = () => {
				const opts = _getTableParseOptions(true);
				if ($selMode.val() === "html") this._tableConverter.doParseHtml(this.inText, opts);
				else this._tableConverter.doParseMarkdown(this.inText, opts);
			};
		};

		if (prevParser) $selParser.val(prevParser).change();
		else renderStatblockSidemenu();
	}

	get menuAccess () {
		return this._menuAccess;
	}

	showWarning (text) {
		$(`#lastWarnings`).show().append(`<div>[Warning] ${text}</div>`);
		this._editorOut.resize();
	}

	doCleanAndOutput (obj, append) {
		const asString = JSON.stringify(obj, null, "\t");
		const asCleanString = TextClean.getCleanedJson(asString);
		if (append) {
			this.outText = `${asCleanString},\n${ui.outText}`;
			this._hasAppended = true;
		} else {
			this.outText = asCleanString;
			this._hasAppended = false;
		}
	}

	set outReadOnly (val) { this._editorOut.setOptions({readOnly: val}); }

	get outText () { return this._editorOut.getValue(); }

	set outText (text) { return this._editorOut.setValue(text, -1); }

	get inText () { return TextClean.getReplacedQuotesText((this._editorIn.getValue() || "").trim()); }

	set inText (text) { return this._editorIn.setValue(text, -1); }

	get pageNumber () { return this._menuAccess.getPage() ? Number(this._menuAccess.getPage()) : undefined; }

	get source () { return this._menuAccess.getSource(); }
}
ConverterUi.STORAGE_INPUT = "converterInput";
ConverterUi.STORAGE_SETTINGS = "converterSettings";

class StatblockConverter {
	static _getValidOptions (options) {
		options = options || {};
		options.isAppend = options.isAppend || false;
		if (!options.cbWarning || !options.cbOutput) throw new Error(`Missing required callback options!`);
		return options;
	}

	/**
	 * Parses statblocks from raw text pastes
	 * @param inText Input text.
	 * @param options Options object.
	 * @param options.cbWarning Warning callback.
	 * @param options.cbOutput Output callback.
	 * @param options.isAppend Default output append mode.
	 */
	doParseText (inText, options) {
		options = StatblockConverter._getValidOptions(options);

		function startNextPhase (cur) {
			return (!cur.toUpperCase().indexOf("ACTIONS") || !cur.toUpperCase().indexOf("LEGENDARY ACTIONS") || !cur.toUpperCase().indexOf("REACTIONS"))
		}

		if (!inText || !inText.trim()) return options.cbWarning("No input!");
		const toConvert = (() => {
			const clean = StatblockConverter._getCleanInput(inText);
			const spl = clean.split(/(Challenge)/i);
			spl[0] = spl[0]
				.replace(/(\d\d?\s+\([-—+]\d\)\s*)+/gi, (...m) => `${m[0].replace(/\n/g, " ").replace(/\s+/g, " ")}\n`); // collapse multi-line ability scores
			return spl.join("").split("\n").filter(it => it && it.trim());
		})();
		const stats = {};
		stats.source = options.source || "";
		// for the user to fill out
		stats.page = options.pageNumber;

		let prevLine = null;
		let curLine = null;
		for (let i = 0; i < toConvert.length; i++) {
			prevLine = curLine;
			curLine = toConvert[i].trim();

			if (curLine === "") continue;

			// name of monster
			if (i === 0) {
				stats.name = this._getCleanName(curLine, options);
				continue;
			}

			// size type alignment
			if (i === 1) {
				StatblockConverter._setCleanSizeTypeAlignment(stats, curLine, options);
				continue;
			}

			// armor class
			if (i === 2) {
				stats.ac = curLine.split_handleColon("Armor Class ", 1)[1];
				continue;
			}

			// hit points
			if (i === 3) {
				StatblockConverter._setCleanHp(stats, curLine);
				continue;
			}

			// speed
			if (i === 4) {
				this._setCleanSpeed(stats, curLine, options);
				continue;
			}

			// ability scores
			if (/STR\s*DEX\s*CON\s*INT\s*WIS\s*CHA/i.test(curLine)) {
				// skip forward a line and grab the ability scores
				++i;
				const abilities = toConvert[i].trim().split(/ ?\(([+\-—])?[0-9]*\) ?/g);
				stats.str = StatblockConverter._tryConvertNumber(abilities[0]);
				stats.dex = StatblockConverter._tryConvertNumber(abilities[2]);
				stats.con = StatblockConverter._tryConvertNumber(abilities[4]);
				stats.int = StatblockConverter._tryConvertNumber(abilities[6]);
				stats.wis = StatblockConverter._tryConvertNumber(abilities[8]);
				stats.cha = StatblockConverter._tryConvertNumber(abilities[10]);
				continue;
			}

			// alternate ability scores (alternating lines of abbreviation and score)
			if (Parser.ABIL_ABVS.includes(curLine.toLowerCase())) {
				// skip forward a line and grab the ability score
				++i;
				switch (curLine.toLowerCase()) {
					case "str": stats.str = StatblockConverter._tryGetStat(toConvert[i]); continue;
					case "dex": stats.dex = StatblockConverter._tryGetStat(toConvert[i]); continue;
					case "con": stats.con = StatblockConverter._tryGetStat(toConvert[i]); continue;
					case "int": stats.int = StatblockConverter._tryGetStat(toConvert[i]); continue;
					case "wis": stats.wis = StatblockConverter._tryGetStat(toConvert[i]); continue;
					case "cha": stats.cha = StatblockConverter._tryGetStat(toConvert[i]); continue;
				}
			}

			// saves (optional)
			if (!curLine.indexOf_handleColon("Saving Throws ")) {
				StatblockConverter._setCleanSaves(stats, curLine, options);
				continue;
			}

			// skills (optional)
			if (!curLine.indexOf_handleColon("Skills ")) {
				StatblockConverter._setCleanSkills(stats, curLine);
				continue;
			}

			// damage vulnerabilities (optional)
			if (!curLine.indexOf_handleColon("Damage Vulnerabilities ")) {
				StatblockConverter._setCleanDamageVuln(stats, curLine);
				continue;
			}

			// damage resistances (optional)
			if (!curLine.indexOf_handleColon("Damage Resistance")) {
				StatblockConverter._setCleanDamageRes(stats, curLine);
				continue;
			}

			// damage immunities (optional)
			if (!curLine.indexOf_handleColon("Damage Immunities ")) {
				StatblockConverter._setCleanDamageImm(stats, curLine);
				continue;
			}

			// condition immunities (optional)
			if (!curLine.indexOf_handleColon("Condition Immunities ")) {
				StatblockConverter._setCleanConditionImm(stats, curLine);
				continue;
			}

			// senses
			if (!curLine.indexOf_handleColon("Senses ")) {
				StatblockConverter._setCleanSenses(stats, curLine);
				continue;
			}

			// languages
			if (!curLine.indexOf_handleColon("Languages ")) {
				StatblockConverter._setCleanLanguages(stats, curLine);
				continue;
			}

			// challenges and traits
			// goes into actions
			if (!curLine.indexOf_handleColon("Challenge ")) {
				StatblockConverter._setCleanCr(stats, curLine);
				continue;
			}

			// traits
			stats.trait = [];
			stats.action = [];
			stats.reaction = [];
			stats.legendary = [];

			let curTrait = {};

			let isTraits = true;
			let isActions = false;
			let isReactions = false;
			let isLegendaryActions = false;
			let isLegendaryDescription = false;

			// keep going through traits til we hit actions
			while (i < toConvert.length) {
				if (startNextPhase(curLine)) {
					isTraits = false;
					isActions = !curLine.toUpperCase().indexOf_handleColon("ACTIONS");
					isReactions = !curLine.toUpperCase().indexOf_handleColon("REACTIONS");
					isLegendaryActions = !curLine.toUpperCase().indexOf_handleColon("LEGENDARY ACTIONS");
					isLegendaryDescription = isLegendaryActions;
					i++;
					curLine = toConvert[i];
				}

				curTrait.name = "";
				curTrait.entries = [];

				const parseFirstLine = line => {
					curTrait.name = line.split(/([.!?])/g)[0];
					curTrait.entries.push(line.substring(curTrait.name.length + 1, line.length).trim());
				};

				if (isLegendaryDescription) {
					// usually the first paragraph is a description of how many legendary actions the creature can make
					// but in the case that it's missing the substring "legendary" and "action" it's probably an action
					const compressed = curLine.replace(/\s*/g, "").toLowerCase();
					if (!compressed.includes("legendary") && !compressed.includes("action")) isLegendaryDescription = false;
				}

				if (isLegendaryDescription) {
					curTrait.entries.push(curLine.trim());
					isLegendaryDescription = false;
				} else {
					parseFirstLine(curLine);
				}

				i++;
				curLine = toConvert[i];

				// collect subsequent paragraphs
				while (curLine && !ConvertUtil.isNameLine(curLine) && !startNextPhase(curLine)) {
					curTrait.entries.push(curLine.trim());
					i++;
					curLine = toConvert[i];
				}

				if (curTrait.name || curTrait.entries) {
					// convert dice tags
					DiceConvert.convertTraitActionDice(curTrait);

					// convert spellcasting
					if (isTraits) {
						if (curTrait.name.toLowerCase().includes("spellcasting")) {
							curTrait = this._tryParseSpellcasting(curTrait, false, options);
							if (curTrait.success) {
								// merge in e.g. innate spellcasting
								if (stats.spellcasting) stats.spellcasting = stats.spellcasting.concat(curTrait.out);
								else stats.spellcasting = curTrait.out;
							} else stats.trait.push(curTrait.out);
						} else {
							if (StatblockConverter._hasEntryContent(curTrait)) stats.trait.push(curTrait);
						}
					}
					if (isActions && StatblockConverter._hasEntryContent(curTrait)) stats.action.push(curTrait);
					if (isReactions && StatblockConverter._hasEntryContent(curTrait)) stats.reaction.push(curTrait);
					if (isLegendaryActions && StatblockConverter._hasEntryContent(curTrait)) stats.legendary.push(curTrait);
				}
				curTrait = {};
			}

			// Remove keys if they are empty
			if (stats.trait.length === 0) delete stats.trait;
			if (stats.reaction.length === 0) delete stats.reaction;
			if (stats.legendary.length === 0) delete stats.legendary;
		}

		stats.cr = stats.cr || "Unknown";

		(function doCleanLegendaryActionHeader () {
			if (stats.legendary) {
				stats.legendary = stats.legendary.map(it => {
					if (!it.name.trim() && !it.entries.length) return null;
					const m = /can take (\d) legendary actions/gi.exec(it.entries[0]);
					if (!it.name.trim() && m) {
						if (m[1] !== "3") stats.legendaryActions = Number(m[1]);
						return null;
					} else return it;
				}).filter(Boolean);
			}
		})();

		this._doStatblockPostProcess(stats, options);
		const statsOut = PropOrder.getOrdered(stats, "monster");
		options.cbOutput(statsOut, options.isAppend);
	}

	/**
	 * Parses statblocks from Homebrewery/GM Binder Markdown
	 * @param inText Input text.
	 * @param options Options object.
	 * @param options.cbWarning Warning callback.
	 * @param options.cbOutput Output callback.
	 * @param options.isAppend Default output append mode.
	 */
	doParseMarkdown (inText, options) {
		options = StatblockConverter._getValidOptions(options);

		const self = this;

		function stripQuote (line) {
			return line.replace(/^\s*>\s*/, "").trim();
		}

		function stripDashStarStar (line) {
			return line.replace(/\**/g, "").replace(/^-/, "").trim();
		}

		function stripTripleHash (line) {
			return line.replace(/^###/, "").trim();
		}

		function stripLeadingSymbols (line) {
			const removeFirstInnerStar = line.trim().startsWith("*");
			const clean = line.replace(/^[^A-Za-z0-9]*/, "").trim();
			return removeFirstInnerStar ? clean.replace(/\*/, "") : clean;
		}

		function isInlineHeader (line) {
			// it should really start with "***" but, homebrew
			return line.trim().startsWith("**");
		}

		if (!inText || !inText.trim()) return options.cbWarning("No input!");
		const toConvert = StatblockConverter._getCleanInput(inText).split("\n");
		let stats = null;

		const getNewStatblock = () => {
			return {
				source: options.source,
				page: options.pageNumber
			}
		};

		let parsed = 0;
		let hasMultipleBlocks = false;
		const doOutputStatblock = () => {
			if (trait != null) doAddFromParsed();
			if (stats) {
				this._doStatblockPostProcess(stats, options);
				const statsOut = PropOrder.getOrdered(stats, "monster");
				options.cbOutput(statsOut, options.isAppend);
			}
			stats = getNewStatblock();
			if (hasMultipleBlocks) options.isAppend = true; // append any further blocks we find in this parse
			parsed = 0;
		};

		let prevLine = null;
		let curLineRaw = null;
		let curLine = null;
		let prevBlank = true;
		let nextPrevBlank = true;
		let trait = null;

		function getCleanTraitText (line) {
			return line.replace(/^\*\*\*?/, "").split(/.\s*\*\*\*?/).map(it => it.trim());
		}

		function doAddFromParsed () {
			if (parsed === 9) { // traits
				doAddTrait();
			} else if (parsed === 10) { // actions
				doAddAction();
			} else if (parsed === 11) { // reactions
				doAddReaction();
			} else if (parsed === 12) { // legendary actions
				doAddLegendary();
			}
		}

		function doAddTrait () {
			if (StatblockConverter._hasEntryContent(trait)) {
				stats.trait = stats.trait || [];

				DiceConvert.convertTraitActionDice(trait);

				// convert spellcasting
				if (trait.name.toLowerCase().includes("spellcasting")) {
					trait = self._tryParseSpellcasting(trait, true, options);
					if (trait.success) {
						// merge in e.g. innate spellcasting
						if (stats.spellcasting) stats.spellcasting = stats.spellcasting.concat(trait.out);
						else stats.spellcasting = trait.out;
					} else stats.trait.push(trait.out);
				} else {
					stats.trait.push(trait)
				}
			}
			trait = null;
		}

		function doAddAction () {
			if (StatblockConverter._hasEntryContent(trait)) {
				stats.action = stats.action || [];

				DiceConvert.convertTraitActionDice(trait);
				stats.action.push(trait);
			}
			trait = null;
		}

		function doAddReaction () {
			if (StatblockConverter._hasEntryContent(trait)) {
				stats.reaction = stats.reaction || [];

				DiceConvert.convertTraitActionDice(trait);
				stats.reaction.push(trait);
			}
			trait = null;
		}

		function doAddLegendary () {
			if (StatblockConverter._hasEntryContent(trait)) {
				stats.legendary = stats.legendary || [];

				DiceConvert.convertTraitActionDice(trait);
				stats.legendary.push(trait);
			}
			trait = null;
		}

		function getCleanedRaw (str) {
			return str.trim()
				.replace(/<br\s*(\/)?>/gi, ""); // remove <br>
		}

		let i = 0;
		for (; i < toConvert.length; i++) {
			prevLine = curLine;
			curLineRaw = getCleanedRaw(toConvert[i]);
			curLine = curLineRaw;

			if (curLine === "" || curLine.toLowerCase() === "\\pagebreak" || curLine.toLowerCase() === "\\columnbreak") {
				prevBlank = true;
				continue;
			} else nextPrevBlank = false;
			curLine = stripQuote(curLine).trim();
			if (curLine === "") continue;
			else if (
				(curLine === "___" && prevBlank) || // handle nicely separated blocks
				curLineRaw === "___" // handle multiple stacked blocks
			) {
				if (stats !== null) hasMultipleBlocks = true;
				doOutputStatblock();
				prevBlank = nextPrevBlank;
				continue;
			} else if (curLine === "___") {
				prevBlank = nextPrevBlank;
				continue;
			}

			// name of monster
			if (parsed === 0) {
				curLine = curLine.replace(/^\s*##/, "").trim();
				stats.name = this._getCleanName(curLine, options);
				parsed++;
				continue;
			}

			// size type alignment
			if (parsed === 1) {
				curLine = curLine.replace(/^\**(.*?)\**$/, "$1");
				StatblockConverter._setCleanSizeTypeAlignment(stats, curLine, options);
				parsed++;
				continue;
			}

			// armor class
			if (parsed === 2) {
				stats.ac = stripDashStarStar(curLine).replace(/Armor Class/g, "").trim();
				parsed++;
				continue;
			}

			// hit points
			if (parsed === 3) {
				StatblockConverter._setCleanHp(stats, stripDashStarStar(curLine));
				parsed++;
				continue;
			}

			// speed
			if (parsed === 4) {
				this._setCleanSpeed(stats, stripDashStarStar(curLine), options);
				parsed++;
				continue;
			}

			// ability scores
			if (parsed === 5 || parsed === 6 || parsed === 7) {
				// skip the two header rows
				if (curLine.replace(/\s*/g, "").startsWith("|STR") || curLine.replace(/\s*/g, "").startsWith("|:-")) {
					parsed++;
					continue;
				}
				const abilities = curLine.split("|").map(it => it.trim()).filter(Boolean);
				Parser.ABIL_ABVS.map((abi, j) => stats[abi] = StatblockConverter._tryGetStat(abilities[j]));
				parsed++;
				continue;
			}

			if (parsed === 8) {
				// saves (optional)
				if (~curLine.indexOf("Saving Throws")) {
					StatblockConverter._setCleanSaves(stats, stripDashStarStar(curLine), options);
					continue;
				}

				// skills (optional)
				if (~curLine.indexOf("Skills")) {
					StatblockConverter._setCleanSkills(stats, stripDashStarStar(curLine));
					continue;
				}

				// damage vulnerabilities (optional)
				if (~curLine.indexOf("Damage Vulnerabilities")) {
					StatblockConverter._setCleanDamageVuln(stats, stripDashStarStar(curLine));
					continue;
				}

				// damage resistances (optional)
				if (~curLine.indexOf("Damage Resistance")) {
					StatblockConverter._setCleanDamageRes(stats, stripDashStarStar(curLine));
					continue;
				}

				// damage immunities (optional)
				if (~curLine.indexOf("Damage Immunities")) {
					StatblockConverter._setCleanDamageImm(stats, stripDashStarStar(curLine));
					continue;
				}

				// condition immunities (optional)
				if (~curLine.indexOf("Condition Immunities")) {
					StatblockConverter._setCleanConditionImm(stats, stripDashStarStar(curLine));
					continue;
				}

				// senses
				if (~curLine.indexOf("Senses")) {
					StatblockConverter._setCleanSenses(stats, stripDashStarStar(curLine));
					continue;
				}

				// languages
				if (~curLine.indexOf("Languages")) {
					StatblockConverter._setCleanLanguages(stats, stripDashStarStar(curLine));
					continue;
				}

				if (~curLine.indexOf("Challenge")) {
					StatblockConverter._setCleanCr(stats, stripDashStarStar(curLine));
					parsed++;
					continue;
				}
			}

			const cleanedLine = stripTripleHash(curLine);
			if (cleanedLine.toLowerCase() === "actions") {
				doAddFromParsed();
				parsed = 10;
				continue;
			} else if (cleanedLine.toLowerCase() === "reactions") {
				doAddFromParsed();
				parsed = 11;
				continue;
			} else if (cleanedLine.toLowerCase() === "legendary actions") {
				doAddFromParsed();
				parsed = 12;
				continue;
			}

			// traits
			if (parsed === 9) {
				if (isInlineHeader(curLine)) {
					doAddTrait();
					trait = {name: "", entries: []};
					const [name, text] = getCleanTraitText(curLine);
					trait.name = name;
					trait.entries.push(stripLeadingSymbols(text));
				} else {
					trait.entries.push(stripLeadingSymbols(curLine));
				}
			}

			// actions
			if (parsed === 10) {
				if (isInlineHeader(curLine)) {
					doAddAction();
					trait = {name: "", entries: []};
					const [name, text] = getCleanTraitText(curLine);
					trait.name = name;
					trait.entries.push(stripLeadingSymbols(text));
				} else {
					trait.entries.push(stripLeadingSymbols(curLine));
				}
			}

			// reactions
			if (parsed === 11) {
				if (isInlineHeader(curLine)) {
					doAddReaction();
					trait = {name: "", entries: []};
					const [name, text] = getCleanTraitText(curLine);
					trait.name = name;
					trait.entries.push(stripLeadingSymbols(text));
				} else {
					trait.entries.push(stripLeadingSymbols(curLine));
				}
			}

			// legendary actions
			if (parsed === 12) {
				if (isInlineHeader(curLine)) {
					doAddLegendary();
					trait = {name: "", entries: []};
					const [name, text] = getCleanTraitText(curLine);
					trait.name = name;
					trait.entries.push(stripLeadingSymbols(text));
				} else {
					if (!trait) { // legendary action intro text
						// ignore generic LA intro; the renderer will insert it
						if (!curLine.toLowerCase().includes("can take 3 legendary actions")) {
							trait = {name: "", entries: [stripLeadingSymbols(curLine)]};
						}
					} else trait.entries.push(stripLeadingSymbols(curLine));
				}
			}
		}

		doOutputStatblock();
	}

	getSample (format) {
		switch (format) {
			case "txt": return StatblockConverter.SAMPLE_TEXT;
			case "md": return StatblockConverter.SAMPLE_MARKDOWN;
			default: throw new Error(`Unknown format "${format}"`);
		}
	}

	// SHARED UTILITY FUNCTIONS ////////////////////////////////////////////////////////////////////////////////////////
	_doStatblockPostProcess (stats, options) {
		const doCleanup = () => {
			// remove any empty arrays
			Object.keys(stats).forEach(k => {
				if (stats[k] instanceof Array && stats[k].length === 0) {
					delete stats[k];
				}
			});
		};

		AcConvert.tryPostProcessAc(
			stats,
			(ac) => options.cbWarning(`AC "${ac}" requires manual conversion`),
			(ac) => options.cbWarning(`Failed to parse AC "${ac}"`)
		);
		TagAttack.tryTagAttacks(stats, (atk) => options.cbWarning(`Manual attack tagging required for "${atk}"`));
		TagHit.tryTagHits(stats);
		TagDc.tryTagDcs(stats);
		TagCondition.tryTagConditions(stats);
		TraitActionTag.tryRun(stats);
		LanguageTag.tryRun(stats);
		SenseTag.tryRun(stats);
		SpellcastingTypeTag.tryRun(stats);
		DamageTypeTag.tryRun(stats);
		MiscTag.tryRun(stats);
		doCleanup();
	}

	static _tryConvertNumber (strNumber) {
		try {
			return Number(strNumber.replace(/—/g, "-"))
		} catch (e) {
			return strNumber;
		}
	}

	static _tryParseType (strType) {
		try {
			const m = /^(.*?) (\(.*?\))\s*$/.exec(strType);
			if (m) {
				return {type: m[1].toLowerCase(), tags: m[2].split(",").map(s => s.replace(/\(/g, "").replace(/\)/g, "").trim().toLowerCase())}
			}
			return strType.toLowerCase();
		} catch (e) {
			return strType;
		}
	}

	static _tryGetStat (strLine) {
		try {
			return StatblockConverter._tryConvertNumber(/(\d+) \(.*?\)/.exec(strLine)[1]);
		} catch (e) {
			return 0;
		}
	}

	/**
	 * Tries to parse immunities, resistances, and vulnerabilities
	 * @param strDamage The string to parse.
	 * @param modProp the output property (e.g. "vulnerable").
	 */
	static _tryParseDamageResVulnImmune (strDamage, modProp) {
		// handle the case where a comma is mistakenly used instead of a semicolon
		if (strDamage.toLowerCase().includes(", bludgeoning, piercing, and slashing from")) {
			strDamage = strDamage.replace(/, (bludgeoning, piercing, and slashing from)/gi, "; $1")
		}

		const splSemi = strDamage.toLowerCase().split(";");
		const newDamage = [];
		try {
			splSemi.forEach(section => {
				const tempDamage = {};
				let pushArray = newDamage;
				if (section.includes("from")) {
					tempDamage[modProp] = [];
					pushArray = tempDamage[modProp];
					tempDamage["note"] = /from .*/.exec(section)[0];
					section = /(.*) from /.exec(section)[1];
				}
				section = section.replace(/and/g, '');
				section.split(",").forEach(s => pushArray.push(s.trim()));
				if ("note" in tempDamage) newDamage.push(tempDamage)
			});
			return newDamage;
		} catch (ignored) {
			return strDamage;
		}
	}

	_tryParseSpellcasting (trait, isMarkdown, options) {
		return SpellcastingTraitConvert.tryParseSpellcasting(trait, isMarkdown, (err) => options.cbWarning(err));
	}

	// SHARED PARSING FUNCTIONS ////////////////////////////////////////////////////////////////////////////////////////
	static _getCleanInput (ipt) {
		return ipt
			.replace(/[−–‒]/g, "-") // convert minus signs to hyphens
		;
	}

	_getCleanName (line, options) {
		return options.isTitleCaseName ? line.toLowerCase().toTitleCase() : line;
	}

	static _setCleanSizeTypeAlignment (stats, line, options) {
		const mSidekick = /^(\d+)(?:st|nd|rd|th)\s*\W+\s*level\s+(.*)$/i.exec(line.trim());
		if (mSidekick) {
			// sidekicks
			stats.level = Number(mSidekick[1]);
			stats.size = mSidekick[2].trim()[0].toUpperCase();
			stats.type = mSidekick[2].split(" ").splice(1).join(" ");
		} else {
			// regular creatures
			stats.size = line[0].toUpperCase();
			stats.type = line.split(StrUtil.COMMAS_NOT_IN_PARENTHESES_REGEX)[0].split(" ").splice(1).join(" ");

			stats.alignment = line.split(StrUtil.COMMAS_NOT_IN_PARENTHESES_REGEX)[1].toLowerCase();
			AlignmentConvert.tryConvertAlignment(stats, (ali) => options.cbWarning(`Alignment "${ali}" requires manual conversion`));
		}
		stats.type = StatblockConverter._tryParseType(stats.type);
	}

	static _setCleanHp (stats, line) {
		const rawHp = line.split_handleColon("Hit Points ", 1)[1];
		// split HP into average and formula
		const m = /^(\d+) \((.*?)\)$/.exec(rawHp);
		if (!m) stats.hp = {special: rawHp}; // for e.g. Avatar of Death
		else {
			stats.hp = {
				average: Number(m[1]),
				formula: m[2]
			};
			DiceConvert.cleanHpDice(stats);
		}
	}

	_setCleanSpeed (stats, line, options) {
		stats.speed = line;
		SpeedConvert.tryConvertSpeed(stats, options.cbWarning);
	}

	static _setCleanSaves (stats, line, options) {
		stats.save = line.split_handleColon("Saving Throws", 1)[1].trim();
		// convert to object format
		if (stats.save && stats.save.trim()) {
			const spl = stats.save.split(",").map(it => it.trim().toLowerCase()).filter(it => it);
			const nu = {};
			spl.forEach(it => {
				const m = /(\w+)\s*([-+])\s*(\d+)/.exec(it);
				if (m) {
					nu[m[1]] = `${m[2]}${m[3]}`;
				} else {
					options.cbWarning(`Save "${it}" requires manual conversion`);
				}
			});
			stats.save = nu;
		}
	}

	static _setCleanSkills (stats, line) {
		stats.skill = line.split_handleColon("Skills", 1)[1].trim().toLowerCase();
		const split = stats.skill.split(",");
		const newSkills = {};
		try {
			split.forEach(s => {
				const splSpace = s.split(" ");
				const val = splSpace.pop().trim();
				let name = splSpace.join(" ").toLowerCase().trim().replace(/ /g, "");
				name = StatblockConverter.SKILL_SPACE_MAP[name] || name;
				newSkills[name] = val;
			});
			stats.skill = newSkills;
			if (stats.skill[""]) delete stats.skill[""]; // remove empty properties
		} catch (ignored) {
			return 0;
		}
	}

	static _setCleanDamageVuln (stats, line) {
		stats.vulnerable = line.split_handleColon("Vulnerabilities", 1)[1].trim();
		stats.vulnerable = StatblockConverter._tryParseDamageResVulnImmune(stats.vulnerable, "vulnerable");
	}

	static _setCleanDamageRes (stats, line) {
		stats.resist = (line.toLowerCase().includes("resistances") ? line.split_handleColon("Resistances", 1) : line.split_handleColon("Resistance", 1))[1].trim();
		stats.resist = StatblockConverter._tryParseDamageResVulnImmune(stats.resist, "resist");
	}

	static _setCleanDamageImm (stats, line) {
		stats.immune = line.split_handleColon("Immunities", 1)[1].trim();
		stats.immune = StatblockConverter._tryParseDamageResVulnImmune(stats.immune, "immune");
	}

	static _setCleanConditionImm (stats, line) {
		stats.conditionImmune = line.split_handleColon("Immunities", 1)[1];
		stats.conditionImmune = StatblockConverter._tryParseDamageResVulnImmune(stats.conditionImmune, "conditionImmune");
	}

	static _setCleanSenses (stats, line) {
		const senses = line.toLowerCase().split_handleColon("senses", 1)[1].trim();
		const tempSenses = [];
		senses.split(StrUtil.COMMA_SPACE_NOT_IN_PARENTHESES_REGEX).forEach(s => {
			s = s.trim();
			if (s) {
				if (s.includes("passive perception")) stats.passive = StatblockConverter._tryConvertNumber(s.split("passive perception")[1].trim());
				else tempSenses.push(s.trim());
			}
		});
		if (tempSenses.length) stats.senses = tempSenses;
		else delete stats.senses;
	}

	static _setCleanLanguages (stats, line) {
		stats.languages = line.split_handleColon("Languages", 1)[1].trim();
		if (stats.languages && /^([-–‒—]|\\u201\d)$/.exec(stats.languages.trim())) delete stats.languages;
		else stats.languages = stats.languages.split(StrUtil.COMMA_SPACE_NOT_IN_PARENTHESES_REGEX);
	}

	static _setCleanCr (stats, line) {
		stats.cr = line.split_handleColon("Challenge", 1)[1].trim().split("(")[0].trim();
	}

	static _hasEntryContent (trait) {
		return trait && (trait.name || (trait.entries.length === 1 && trait.entries[0]) || trait.entries.length > 1);
	}
}
StatblockConverter.SKILL_SPACE_MAP = {
	"sleightofhand": "sleight of hand",
	"animalhandling": "animal handling"
};
StatblockConverter.SAMPLE_TEXT =
`Mammon
Huge fiend (devil), lawful evil
Armor Class 20 (natural armor)
Hit Points 378 (28d12 + 196)
Speed 50 ft.
STR DEX CON INT WIS CHA
22 (+6) 13 (+1) 24 (+7) 23 (+6) 21 (+5) 26 (+8)
Saving Throws Dex +9, Int +14, Wis +13, Cha +16
Skills Deception +16, Insight +13, Perception +13, Persuasion +16
Damage Resistances cold
Damage Immunities fire, poison; bludgeoning, piercing, and slashing from weapons that aren't silvered
Condition Immunities charmed, exhaustion, frightened, poisoned
Senses truesight 120 ft., passive Perception 23
Languages all, telepathy 120 ft.
Challenge 25 (75,000 XP)
Innate Spellcasting. Mammon's innate spellcasting ability is Charisma (spell save DC 24, +16 to hit with spell attacks). He can innately cast the following spells, requiring no material components:
At will: charm person, detect magic, dispel magic, fabricate (Mammon can create valuable objects), heat metal, magic aura
3/day each: animate objects, counterspell, creation, instant summons, legend lore, teleport
1/day: imprisonment (minimus containment only, inside gems), sunburst
Spellcasting. Mammon is a 6th level spellcaster. His spellcasting ability is Intelligence (spell save DC 13; +5 to hit with spell attacks). He has the following wizard spells prepared:
Cantrips (at will): fire bolt, light, mage hand, prestidigitation
1st level (4 slots): mage armor, magic missile, shield
2nd level (3 slots): misty step, suggestion
3rd level (3 slots): fly, lightning bolt
Legendary Resistance (3/day). If Mammon fails a saving throw, he can choose to succeed instead.
Magic Resistance. Mammon has advantage on saving throws against spells and other magical effects.
Magic Weapons. Mammon's weapon attacks are magical.
ACTIONS
Multiattack. Mammon makes three attacks.
Purse. Melee Weapon Attack: +14 to hit, reach 10 ft., one target. Hit: 19 (3d8 + 6) bludgeoning damage plus 18 (4d8) radiant damage.
Molten Coins. Ranged Weapon Attack: +14 to hit, range 40/120 ft., one target. Hit: 16 (3d6 + 6) bludgeoning damage plus 18 (4d8) fire damage.
Your Weight In Gold (Recharge 5-6). Mammon can use this ability as a bonus action immediately after hitting a creature with his purse attack. The creature must make a DC 24 Constitution saving throw. If the saving throw fails by 5 or more, the creature is instantly petrified by being turned to solid gold. Otherwise, a creature that fails the saving throw is restrained. A restrained creature repeats the saving throw at the end of its next turn, becoming petrified on a failure or ending the effect on a success. The petrification lasts until the creature receives a greater restoration spell or comparable magic.
LEGENDARY ACTIONS
Mammon can take 3 legendary actions, choosing from the options below. Only one legendary action option can be used at a time and only at the end of another creature's turn. Mammon regains spent legendary actions at the start of his turn.
Attack. Mammon makes one purse or molten coins attack.
Make It Rain! Mammon casts gold and jewels into a 5-foot radius within 60 feet. One creature within 60 feet of the treasure that can see it must make a DC 24 Wisdom saving throw. On a failure, the creature must use its reaction to move its speed toward the trinkets, which vanish at the end of the turn.
Deep Pockets (3 actions). Mammon recharges his Your Weight In Gold ability.`;
StatblockConverter.SAMPLE_MARKDOWN =
`___
>## Lich
>*Medium undead, any evil alignment*
>___
>- **Armor Class** 17
>- **Hit Points** 135 (18d8 + 54)
>- **Speed** 30 ft.
>___
>|STR|DEX|CON|INT|WIS|CHA|
>|:---:|:---:|:---:|:---:|:---:|:---:|
>|11 (+0)|16 (+3)|16 (+3)|20 (+5)|14 (+2)|16 (+3)|
>___
>- **Saving Throws** Con +10, Int +12, Wis +9
>- **Skills** Arcana +19, History +12, Insight +9, Perception +9
>- **Damage Resistances** cold, lightning, necrotic
>- **Damage Immunities** poison; bludgeoning, piercing, and slashing from nonmagical attacks
>- **Condition Immunities** charmed, exhaustion, frightened, paralyzed, poisoned
>- **Senses** truesight 120 ft., passive Perception 19
>- **Languages** Common plus up to five other languages
>- **Challenge** 21 (33000 XP)
>___
>***Legendary Resistance (3/Day).*** If the lich fails a saving throw, it can choose to succeed instead.
>
>***Rejuvenation.*** If it has a phylactery, a destroyed lich gains a new body in 1d10 days, regaining all its hit points and becoming active again. The new body appears within 5 feet of the phylactery.
>
>***Spellcasting.*** The lich is an 18th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 20, +12 to hit with spell attacks). The lich has the following wizard spells prepared:
>
>• Cantrips (at will): mage hand, prestidigitation, ray of frost
>• 1st level (4 slots): detect magic, magic missile, shield, thunderwave
>• 2nd level (3 slots): detect thoughts, invisibility, Melf's acid arrow, mirror image
>• 3rd level (3 slots): animate dead, counterspell, dispel magic, fireball
>• 4th level (3 slots): blight, dimension door
>• 5th level (3 slots): cloudkill, scrying
>• 6th level (1 slot): disintegrate, globe of invulnerability
>• 7th level (1 slot): finger of death, plane shift
>• 8th level (1 slot): dominate monster, power word stun
>• 9th level (1 slot): power word kill
>
>***Turn Resistance.*** The lich has advantage on saving throws against any effect that turns undead.
>
>### Actions
>***Paralyzing Touch.*** Melee Spell Attack: +12 to hit, reach 5 ft., one creature. Hit: 10 (3d6) cold damage. The target must succeed on a DC 18 Constitution saving throw or be paralyzed for 1 minute. The target can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success.
>
>### Legendary Actions
>The lich can take 3 legendary actions, choosing from the options below. Only one legendary action option can be used at a time and only at the end of another creature's turn. The lich regains spent legendary actions at the start of its turn.
>
>***Cantrip.*** The lich casts a cantrip.
>
>***Paralyzing Touch (Costs 2 Actions).*** The lich uses its Paralyzing Touch.
>
>***Frightening Gaze (Costs 2 Actions).*** The lich fixes its gaze on one creature it can see within 10 feet of it. The target must succeed on a DC 18 Wisdom saving throw against this magic or become frightened for 1 minute. The frightened target can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success. If a target's saving throw is successful or the effect ends for it, the target is immune to the lich's gaze for the next 24 hours.
>
>***Disrupt Life (Costs 3 Actions).*** Each non-undead creature within 20 feet of the lich must make a DC 18 Constitution saving throw against this magic, taking 21 (6d6) necrotic damage on a failed save, or half as much damage on a successful one.
>
>`;

class TableConverter {
	showSample (format) {
		switch (format) {
			case "html": return TableConverter.SAMPLE_HTML;
			case "md": return TableConverter.SAMPLE_MARKDOWN;
			default: throw new Error(`Unknown format "${format}"`)
		}
	}

	static _doCleanTable (tbl) {
		if (!tbl.caption) delete tbl.caption;
		if (tbl.colLabels && !tbl.colLabels.some(Boolean)) delete tbl.colLabels;
		if (tbl.colStyles && !tbl.colStyles.some(Boolean)) delete tbl.colStyles;
		if (!tbl.rows.some(Boolean)) throw new Error("Table had no rows!");
	}

	/**
	 * Parses tables from HTML.
	 * @param inText Input text.
	 * @param options Options object.
	 * @param options.cbWarning Warning callback.
	 * @param options.cbOutput Output callback.
	 * @param options.isAppend Default output append mode.
	 */
	doParseHtml (inText, options) {
		if (!inText || !inText.trim()) return options.cbWarning("No input!");

		const handleTable = ($table, caption) => {
			const tbl = {
				type: "table",
				caption,
				colLabels: [],
				colStyles: [],
				rows: []
			};

			const getCleanHeaderText = ($ele) => {
				let txt = $ele.text().trim();

				// if it's all-uppercase, title-case it
				if (txt.toUpperCase() === txt) txt = txt.toTitleCase();

				return txt;
			};

			// Caption
			if ($table.find(`caption`)) {
				tbl.caption = $table.find(`caption`).text().trim();
			}

			// Columns
			if ($table.find(`thead`)) {
				const $headerRows = $table.find(`thead tr`);
				if ($headerRows.length !== 1) options.cbWarning(`Table header had ${$headerRows.length} rows!`);
				$headerRows.each((i, r) => {
					const $r = $(r);
					if (i === 0) { // use first tr as column headers
						$r.find(`th, td`).each((i, h) => tbl.colLabels.push(getCleanHeaderText($(h))));
					} else { // use others as rows
						const row = [];
						$r.find(`th, td`).each((i, h) => row.push(getCleanHeaderText($(h))));
						if (row.length) tbl.rows.push(row);
					}
				});
				$table.find(`thead`).remove();
			} else if ($table.find(`th`)) {
				$table.find(`th`).each((i, h) => tbl.colLabels.push(getCleanHeaderText($(h))));
				$table.find(`th`).parent().remove();
			}

			// Rows
			const handleTableRow = (i, r) => {
				const $r = $(r);
				const row = [];
				$r.find(`td`).each((i, cell) => {
					const $cell = $(cell);
					row.push($cell.text().trim());
				});
				tbl.rows.push(row);
			};

			if ($table.find(`tbody`)) {
				$table.find(`tbody tr`).each(handleTableRow);
			} else {
				$table.find(`tr`).each(handleTableRow);
			}

			this._postProcessTable(tbl);
			options.cbOutput(tbl, options.isAppend);
		};

		const $input = $(inText);
		if ($input.is("table")) {
			handleTable($input);
		} else {
			// TODO pull out any preceding text to use as the caption; pass this in
			const caption = "";
			$input.find("table").each((i, e) => {
				const $table = $(e);
				handleTable($table, caption);
			});
		}
	}

	/**
	 * Parses tables from Markdown.
	 * @param inText Input text.
	 * @param options Options object.
	 * @param options.cbWarning Warning callback.
	 * @param options.cbOutput Output callback.
	 * @param options.isAppend Default output append mode.
	 */
	doParseMarkdown (inText, options) {
		if (!inText || !inText.trim()) return options.cbWarning("No input!");

		const getConvertedTable = (lines, caption) => {
			// trim leading/trailing pipes if they're uniformly present
			const contentLines = lines.filter(l => l && l.trim());
			if (contentLines.every(l => l.trim().startsWith("|"))) {
				lines = lines.map(l => l.replace(/^\s*\|(.*?)$/, "$1"));
			}
			if (contentLines.every(l => l.trim().endsWith("|"))) {
				lines = lines.map(l => l.replace(/^(.*?)\|\s*$/, "$1"));
			}

			const tbl = {
				type: "table",
				caption,
				colLabels: [],
				colStyles: [],
				rows: []
			};

			let seenHeaderBreak = false;
			let alignment = [];
			lines.map(l => l.trim()).filter(Boolean).forEach(l => {
				const cells = l.split("|").map(it => it.trim());
				if (cells.length) {
					if (cells.every(c => !c || !!/^:?\s*---+\s*:?$/.exec(c))) { // a header break
						alignment = cells.map(c => {
							if (c.startsWith(":") && c.endsWith(":")) {
								return "text-center";
							} else if (c.startsWith(":")) {
								return "text-align-left";
							} else if (c.endsWith(":")) {
								return "text-right";
							} else {
								return "";
							}
						});
						seenHeaderBreak = true;
					} else if (seenHeaderBreak) {
						tbl.rows.push(cells);
					} else {
						tbl.colLabels = cells;
					}
				}
			});

			tbl.colStyles = alignment;

			this._postProcessTable(tbl);
			return tbl;
		};

		const lines = inText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n/g);
		const stack = [];
		let cur = null;
		lines.forEach(l => {
			if (l.trim().startsWith("##### ")) {
				if (cur && cur.lines.length) stack.push(cur);
				cur = {caption: l.trim().replace(/^##### /, ""), lines: []};
			} else {
				cur = cur || {lines: []};
				cur.lines.push(l);
			}
		});
		if (cur && cur.lines.length) stack.push(cur);

		const toOutput = stack.map(tbl => getConvertedTable(tbl.lines, tbl.caption)).reverse();
		toOutput.forEach((out, i) => {
			if (options.isAppend) options.cbOutput(out, true);
			else {
				if (i === 0) options.cbOutput(out, false);
				else options.cbOutput(out, true);
			}
		});
	}

	_postProcessTable (tbl) {
		// Post-processing
		(function normalizeCellCounts () {
			// pad all rows to max width
			const maxWidth = Math.max(tbl.colLabels, ...tbl.rows.map(it => it.length));
			tbl.rows.forEach(row => {
				while (row.length < maxWidth) row.push("");
			});
		})();

		(function doCalculateWidths () {
			const BASE_CHAR_CAP = 200; // assume tables are approx 200 characters wide

			// total the
			const avgWidths = (() => {
				if (!tbl.rows.length) return null;
				const out = [...new Array(tbl.rows[0].length)].map(() => 0);
				tbl.rows.forEach(r => {
					r.forEach((cell, i) => {
						out[i] += Math.min(BASE_CHAR_CAP, cell.length);
					});
				});
				return out.map(it => it / tbl.rows.length);
			})();

			if (avgWidths != null) {
				const totalWidths = avgWidths.reduce((a, b) => a + b, 0);
				const redistributedWidths = (() => {
					const MIN = totalWidths / 12;
					const sorted = avgWidths.map((it, i) => ({ix: i, val: it})).sort((a, b) => SortUtil.ascSort(a.val, b.val));

					for (let i = 0; i < sorted.length - 1; ++i) {
						const it = sorted[i];
						if (it.val < MIN) {
							const diff = MIN - it.val;
							sorted[i].val = MIN;
							const toSteal = diff / sorted.length - (i + 1);
							for (let j = i + 1; j < sorted.length; ++j) {
								sorted[j].val -= toSteal;
							}
						}
					}

					return sorted.sort((a, b) => SortUtil.ascSort(a.ix, b.ix)).map(it => it.val);
				})();
				let nmlxWidths = redistributedWidths.map(it => it / totalWidths);
				while (nmlxWidths.reduce((a, b) => a + b, 0) > 1) {
					const diff = 1 - nmlxWidths.reduce((a, b) => a + b, 0);
					nmlxWidths = nmlxWidths.map(it => it + diff / nmlxWidths.length);
				}
				const twelfthWidths = nmlxWidths.map(it => Math.round(it * 12));

				twelfthWidths.forEach((it, i) => {
					const widthPart = `col-${it}`;
					tbl.colStyles[i] = tbl.colStyles[i] ? `${tbl.colStyles[i]} ${widthPart}` : widthPart;
				});
			}
		})();

		(function doCheckDiceCol () {
			// check if first column is dice
			let isDiceCol0 = true;
			tbl.rows.forEach(r => {
				if (isNaN(Number(r[0]))) isDiceCol0 = false;
			});
			if (isDiceCol0 && !tbl.colStyles.includes("text-center")) tbl.colStyles[0] += " text-center";
		})();

		(function tagRowDice () {
			tbl.rows = tbl.rows.map(r => r.map(c => c.replace(RollerUtil.DICE_REGEX, `{@dice $&}`)));
		})();

		TableConverter._doCleanTable(tbl);
	}
}
TableConverter.SAMPLE_HTML =
`<table>
  <thead>
    <tr>
      <td><p><strong>Character Level</strong></p></td>
      <td><p><strong>Low Magic Campaign</strong></p></td>
      <td><p><strong>Standard Campaign</strong></p></td>
      <td><p><strong>High Magic Campaign</strong></p></td>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><p>1st–4th</p></td>
      <td><p>Normal starting equipment</p></td>
      <td><p>Normal starting equipment</p></td>
      <td><p>Normal starting equipment</p></td>
    </tr>
    <tr>
      <td><p>5th–10th</p></td>
      <td><p>500 gp plus 1d10 × 25 gp, normal starting equipment</p></td>
      <td><p>500 gp plus 1d10 × 25 gp, normal starting equipment</p></td>
      <td><p>500 gp plus 1d10 × 25 gp, one uncommon magic item, normal starting equipment</p></td>
    </tr>
    <tr>
      <td><p>11th–16th</p></td>
      <td><p>5,000 gp plus 1d10 × 250 gp, one uncommon magic item, normal starting equipment</p></td>
      <td><p>5,000 gp plus 1d10 × 250 gp, two uncommon magic items, normal starting equipment</p></td>
      <td><p>5,000 gp plus 1d10 × 250 gp, three uncommon magic items, one rare item, normal starting equipment</p></td>
    </tr>
    <tr>
      <td><p>17th–20th</p></td>
      <td><p>20,000 gp plus 1d10 × 250 gp, two uncommon magic items, normal starting equipment</p></td>
      <td><p>20,000 gp plus 1d10 × 250 gp, two uncommon magic items, one rare item, normal starting equipment</p></td>
      <td><p>20,000 gp plus 1d10 × 250 gp, three uncommon magic items, two rare items, one very rare item, normal starting equipment</p></td>
    </tr>
  </tbody>
</table>`;
TableConverter.SAMPLE_MARKDOWN =
`| Character Level | Low Magic Campaign                                                                | Standard Campaign                                                                                | High Magic Campaign                                                                                                     |
|-----------------|-----------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| 1st–4th         | Normal starting equipment                                                         | Normal starting equipment                                                                        | Normal starting equipment                                                                                               |
| 5th–10th        | 500 gp plus 1d10 × 25 gp, normal starting equipment                               | 500 gp plus 1d10 × 25 gp, normal starting equipment                                              | 500 gp plus 1d10 × 25 gp, one uncommon magic item, normal starting equipment                                            |
| 11th–16th       | 5,000 gp plus 1d10 × 250 gp, one uncommon magic item, normal starting equipment   | 5,000 gp plus 1d10 × 250 gp, two uncommon magic items, normal starting equipment                 | 5,000 gp plus 1d10 × 250 gp, three uncommon magic items, one rare item, normal starting equipment                       |
| 17th–20th       | 20,000 gp plus 1d10 × 250 gp, two uncommon magic items, normal starting equipment | 20,000 gp plus 1d10 × 250 gp, two uncommon magic items, one rare item, normal starting equipment | 20,000 gp plus 1d10 × 250 gp, three uncommon magic items, two rare items, one very rare item, normal starting equipment |`;

const statblockConverter = new StatblockConverter();
const tableConverter = new TableConverter();
const ui = new ConverterUi();

ui.statblockConverter = statblockConverter;
ui.tableConverter = tableConverter;

async function doPageInit () {
	ExcludeUtil.pInitialise(); // don't await, as this is only used for search
	await BrewUtil.pAddBrewData(); // init homebrew
	const spellData = await SpellcastingTraitConvert.pGetSpellData();
	SpellcastingTraitConvert.init(spellData);
	ui.init();
}
