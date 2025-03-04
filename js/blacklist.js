"use strict";

class Blacklist {
	static getDisplayCategory (cat) {
		if (cat === "variantrule") return "Variant Rule";
		if (cat === "optionalfeature") return "Optional Feature";
		if (cat === "variant") return "Magic Item Variant";
		return cat.uppercaseFirst();
	}

	static getDisplayValues (category, source) {
		const displaySource = source === "*" ? source : Parser.sourceJsonToFullCompactPrefix(source);
		const displayCategory = category === "*" ? category : Blacklist.getDisplayCategory(category);
		return {displaySource, displayCategory};
	}

	static _renderList () {
		ExcludeUtil.getList()
			.sort((a, b) => SortUtil.ascSort(a.source, b.source) || SortUtil.ascSort(a.category, b.category) || SortUtil.ascSort(a.name, b.name))
			.forEach(({name, category, source}) => Blacklist._addListItem(name, category, source));
	}

	static async pInitialise () {
		Blacklist._list = new List("listcontainer", {
			valueNames: ["id", "source", "category", "name"],
			listClass: "blacklist",
			item: `<li class="row no-click"><span class="id hidden"></span><span class="source col-3"></span><span class="category col-3"></span><span class="name col-3"></span><span class="actions col-3 text-center"></span></li>`
		});
		Blacklist._listId = 1;
		ListUtil.bindEscapeKey(Blacklist._list, $(`#search`));

		const FILES = [
			"backgrounds.json",
			"cultsboons.json",
			"deities.json",
			"feats.json",
			"magicvariants.json",
			"optionalfeatures.json",
			"objects.json",
			"psionics.json",
			"races.json",
			"rewards.json",
			"trapshazards.json",
			"variantrules.json"
		];

		const $selSource = $(`#bl-source`);
		const $selCategory = $(`#bl-category`);
		const $selName = $(`#bl-name`);

		const data = {};

		function mergeData (fromRec) {
			Object.keys(fromRec).filter(it => !Blacklist.IGNORED_CATEGORIES.has(it))
				.forEach(k => data[k] ? data[k] = data[k].concat(fromRec[k]) : data[k] = fromRec[k])
		}

		// LOAD DATA ===============================================================================
		// bestiary
		const ixBestiary = await DataUtil.loadJSON(`data/bestiary/index.json`);
		const allBestiaryData = await Promise.all(Object.values(ixBestiary).map(f => DataUtil.loadJSON(`data/bestiary/${f}`)));
		allBestiaryData.forEach(d => mergeData(d));

		// spells
		const ixSpells = await DataUtil.loadJSON(`data/spells/index.json`);
		const allSpellData = await Promise.all(Object.values(ixSpells).map(f => DataUtil.loadJSON(`data/spells/${f}`)));
		allSpellData.forEach(d => mergeData(d));

		// classes
		const classData = await DataUtil.class.loadJSON();
		classData.class.forEach(c => (c.subclasses || []).forEach(sc => sc.class = c.name));
		classData.subclass = classData.subclass || [];
		classData.class.forEach(c => classData.subclass = classData.subclass.concat(c.subclasses || []));
		mergeData(classData);

		// everything else
		const promises = FILES.map(url => DataUtil.loadJSON(`data/${url}`));
		promises.push(async () => ({item: await Renderer.items.pBuildList({isAddGroups: true})}));
		const contentData = await Promise.all(promises);
		contentData.forEach(d => {
			if (d.race) d.race = Renderer.race.mergeSubraces(d.race);
			if (d.variant) d.variant.forEach(it => it.source = it.source || it.inherits.source);
			mergeData(d);
		});

		// PROCESS DATA ============================================================================
		const sourceSet = new Set();
		const catSet = new Set();
		Object.keys(data).forEach(cat => {
			catSet.add(cat);
			const arr = data[cat];
			arr.forEach(it => sourceSet.has(it.source) || sourceSet.add(it.source));
		});

		[...sourceSet]
			.sort((a, b) => SortUtil.ascSort(Parser.sourceJsonToFull(a), Parser.sourceJsonToFull(b)))
			.forEach(source => $selSource.append(`<option value="${source}">${Parser.sourceJsonToFull(source)}</option>`));

		[...catSet]
			.sort((a, b) => SortUtil.ascSort(Blacklist.getDisplayCategory(a), Blacklist.getDisplayCategory(b)))
			.forEach(cat => $selCategory.append(`<option value="${cat}">${Blacklist.getDisplayCategory(cat)}</option>`));

		function onSelChange () {
			function populateName (arr, cat) {
				const copy = cat === "subclass"
					? arr.map(it => ({name: it.name, source: it.source, class: it.class})).sort((a, b) => SortUtil.ascSort(a.class, b.class) || SortUtil.ascSort(a.name, b.name) || SortUtil.ascSort(a.source, b.source))
					: arr.map(({name, source}) => ({name, source})).sort((a, b) => SortUtil.ascSort(a.name, b.name) || SortUtil.ascSort(a.source, b.source));
				const dupes = new Set();
				let temp = "";
				copy.forEach((it, i) => {
					temp += `<option value="${it.name}|${it.source}">${cat === "subclass" ? `${it.class}: ` : ""}${it.name}${(dupes.has(it.name) || (copy[i + 1] && copy[i + 1].name === it.name)) ? ` (${Parser.sourceJsonToAbv(it.source)})` : ""}</option>`;
					dupes.add(it.name);
				});
				$selName.append(temp);
			}

			const cat = $selCategory.val();
			$selName.empty();
			$selName.append(`<option value="*">*</option>`);
			if (cat !== "*") {
				const source = $selSource.val();
				if (source === "*") populateName(data[cat], cat);
				else populateName(data[cat].filter(it => it.source === source), cat);
			}
		}

		$selSource.change(onSelChange);
		$selCategory.change(onSelChange);

		Blacklist._renderList();

		const $page = $(`#main_content`);
		$page.find(`.loading`).prop("disabled", false);
		$page.find(`.loading-temp`).remove();
	}

	static _addListItem (name, category, source) {
		const display = Blacklist.getDisplayValues(category, source);
		const added = Blacklist._list.add([
			{id: Blacklist._listId++, name: name, category: display.displayCategory, source: display.displaySource}
		]);
		$(`<button class="btn btn-xs btn-danger m-1">Remove</button>`).click(() => {
			Blacklist.pRemove(name, category, source);
		}).appendTo($(added[0].elm).find(`.actions`));
	}

	static async add () {
		const $selSource = $(`#bl-source`);
		const $selCategory = $(`#bl-category`);
		const $selName = $(`#bl-name`);

		const source = $selSource.val();
		const category = $selCategory.val();
		const name = $selName.val().split("|")[0];

		if (source === "*" && category === "*" && name === "*" && !window.confirm("This will exclude all content from all list pages. Are you sure?")) return;

		if (await ExcludeUtil.pAddExclude(name, category, source)) {
			Blacklist._addListItem(name, category, source);
		}
	}

	static addAllUa () {
		$(`#bl-source`).find(`option`).each(async (i, e) => {
			const val = $(e).val();
			if (val === "*" || !SourceUtil.isNonstandardSource(val)) return;

			if (await ExcludeUtil.pAddExclude("*", "*", val)) {
				Blacklist._addListItem("*", "*", val);
			}
		});
	}

	static async pRemove (name, category, source) {
		await ExcludeUtil.pRemoveExclude(name, category, source);
		const display = Blacklist.getDisplayValues(category, source);
		// List JS doesn't support matching by multiple fields...
		Blacklist._list.items
			.filter(it => it.values().name === name && it.values().category === display.displayCategory && it.values().source === display.displaySource)
			.map(it => it.values().id)
			.forEach(id => Blacklist._list.remove("id", id));
	}

	static export () {
		const filename = `content-blacklist`;
		DataUtil.userDownload(filename, JSON.stringify({blacklist: ExcludeUtil.getList()}, null, "\t"));
	}

	static import (evt) {
		function loadSaved (event, additive) {
			const input = event.target;

			const reader = new FileReader();
			reader.onload = async () => {
				const text = reader.result;
				const json = JSON.parse(text);

				// clear list display
				$(".blacklist").empty();
				Blacklist._list.reIndex();

				// update storage
				if (!additive) await ExcludeUtil.pSetList(json.blacklist || []);
				else await ExcludeUtil.pSetList(ExcludeUtil.getList().concat(json.blacklist || []));

				await BrewUtil.pDoHandleBrewJson(json, "NO_PAGE");

				// render list display
				Blacklist._renderList();

				$iptAdd.remove();
			};
			reader.readAsText(input.files[0]);
		}

		const additive = evt.shiftKey;
		const $iptAdd = $(`<input type="file" accept=".json" style="position: fixed; top: -100px; left: -100px; display: none;">`).on("change", (evt) => {
			loadSaved(evt, additive);
		}).appendTo($(`body`));
		$iptAdd.click();
	}

	static async pReset () {
		await ExcludeUtil.pResetExcludes();
		$(".blacklist").empty();
		Blacklist._list.reIndex();
	}
}
Blacklist.IGNORED_CATEGORIES = new Set([
	"_meta",
	"linkedLootTables"
]);

window.addEventListener("load", async () => {
	await ExcludeUtil.pInitialise();
	Blacklist.pInitialise();
});
