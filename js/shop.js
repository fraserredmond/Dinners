/* The shopping list: the week's dinners (scaled to the household), the regulars and anything
 * added by hand, combined into one line per item, grouped by shop section and put in the order
 * you walk round the shop. Needs FridgeScale (scale.js).
 * Works in Node (require) and as a plain script (globalThis.FridgeShop). */
"use strict";

(function (root) {
	const Scale = typeof module !== "undefined" && module.exports ? require("./scale.js") : root.FridgeScale;
	const WHOLE = ["tin", "carton", "pack", "jar", "bunch", "slice", ""]; // bought whole: round up
	const OTHER = "Other";

	/** Letters only, lower case, no accents: "Crème Fraîche" -> "creme fraiche" */
	function plain(s) {
		return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
			.replace(/[^a-z0-9]+/g, " ").trim();
	}

	/** One key per item, whatever the plural or capitals: "Garlic Cloves" and "garlic clove" match. */
	function itemKey(item) {
		const words = plain(item).split(" ").filter(Boolean);
		return words.map(function (w) { return w.length > 3 ? Scale.singular(w) : w; }).join(" ");
	}

	function capital(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

	/** How a total reads: 1250g -> "1.25kg", 2 tins -> "2 tins", 10 -> "10" */
	function amountText(q, unit) {
		if (unit === "g" && q >= 1000) return Scale.formatQty(Math.round(q / 10) / 100) + "kg";
		if (unit === "ml" && q >= 1000) return Scale.formatQty(Math.round(q / 10) / 100) + "l";
		if (!unit) return Scale.formatQty(q);
		if (unit === "g" || unit === "ml") return Scale.formatQty(q) + unit;
		const plural = q > 1 && ["tin", "carton", "pack", "jar", "bunch", "slice"].indexOf(unit) !== -1 ? (unit === "bunch" ? "es" : "s") : "";
		return Scale.formatQty(q) + " " + unit + plural;
	}

	/** "x3", "3", "×3" -> 3; anything else -> null */
	function countOf(text) {
		const m = /^\s*[x×]?\s*(\d+)\s*[x×]?\s*$/i.exec(String(text || ""));
		return m ? Number(m[1]) : null;
	}

	/**
	 * How an item reads on the list, like a handwritten one: counts as "×3" (nothing for 1),
	 * whole tins and cartons as a count too, weights and spoons in brackets.
	 */
	function labelOf(name, parts, extra) {
		let out = name;
		if (parts.length === 1 && WHOLE.indexOf(parts[0].u) !== -1) {
			if (parts[0].q > 1) out += " \u00d7" + Scale.formatQty(parts[0].q);
		} else if (parts.length) {
			out += " (" + parts.map(function (p) { return amountText(p.q, p.u); }).join(" + ") + ")";
		}
		if (extra) {
			const n = countOf(extra);
			if (n === null) out += " (" + extra + ")";
			else if (n > 1) out += " \u00d7" + n;
		}
		return out;
	}

	/** The amount on its own, for the Sheet's Qty column: "500g, ×2", "20ml + 2 tsp", "×3" */
	function qtyOf(parts, extra) {
		const out = [];
		if (parts.length === 1 && WHOLE.indexOf(parts[0].u) !== -1) {
			if (parts[0].q > 1) out.push("\u00d7" + Scale.formatQty(parts[0].q));
		} else if (parts.length) {
			out.push(parts.map(function (p) { return amountText(p.q, p.u); }).join(" + "));
		}
		if (extra) {
			const n = countOf(extra);
			if (n === null) out.push(extra);
			else if (n > 1) out.push("\u00d7" + n);
		}
		return out.join(", ");
	}

	/** An amount you set yourself ("1", "x2", "1kg bag"): as the label shows it, and for the Qty column. */
	function ownLabel(name, own) {
		const n = countOf(own);
		if (n === null) return name + " (" + own + ")";
		return n > 1 ? name + " \u00d7" + n : name;
	}
	function ownQty(own) {
		const n = countOf(own);
		return n === null ? own : n > 1 ? "\u00d7" + n : "";
	}

	/** Only a spoonful or a few grams: probably in the cupboard already. */
	function smallAmount(parts) {
		return parts.length > 0 && parts.every(function (p) {
			return ["tsp", "tbsp", "pinch"].indexOf(p.u) !== -1 || ((p.u === "g" || p.u === "ml") && p.q <= 30);
		});
	}

	/** The shortest name for a recipe: "Ribollita" rather than "Tuscan Ribollita Inspired Soup". */
	function shortName(r) {
		return [r.title].concat(r.aliases || []).filter(Boolean)
			.reduce(function (a, b) { return b.length < a.length ? b : a; });
	}

	/** The Shop order tab as rules: [{ section, order, words: ["apple", ...] }] */
	function orderRules(rows) {
		return (rows || []).map(function (r, i) {
			return {
				section: plain(r.section), order: Number(r.order) || 999, row: i,
				words: (Array.isArray(r.words) ? r.words : String(r.words || "").split(/[,;\n]/))
					.map(function (w) { return itemKey(w); }).filter(Boolean)
			};
		});
	}

	/** Where an item goes within its section: [group, place in group]; unmatched items go last. */
	function placeOf(key, section, rules) {
		const words = key.split(" ");
		let best = null;
		rules.forEach(function (r) {
			if (r.section !== plain(section)) return;
			r.words.forEach(function (w, i) {
				const hit = (" " + key + " ").indexOf(" " + w + " ") !== -1 ||
					(w.length >= 4 && w.indexOf(" ") === -1 && words.some(function (x) { return x.length > w.length && x.slice(-w.length) === w; }));
				if (!hit) return;
				// the longest matching word wins ("chicken slices" beats "chicken"), then the earlier group
				if (!best || w.length > best.len || (w.length === best.len && (r.order < best.order || (r.order === best.order && r.row < best.row)))) {
					best = { len: w.length, order: r.order, row: r.row, i: i };
				}
			});
		});
		return best ? [best.order, best.row, best.i] : [1e9, 0, 0];
	}

	/**
	 * Builds the list.
	 * input: {
	 *   dinners: [{ day, recipeId }], recipes: { id: { title, aliases, servings, ingredients: [...] } },
	 *   household, regulars: [{ item, qty, section }], added: [{ item, qty, section }],
	 *   unticked: [keys], sections: [{ name, order, onPaper }], order: [{ section, order, words }]
	 * }
	 * Returns { groups: [{ name, block, items: [{ key, name, qty, label, section, from, source, ticked }] }], count }
	 */
	function buildList(input) {
		const household = Number(input.household) || 4;
		const lines = {}; // key -> line
		const add = function (key, make) {
			if (!lines[key]) lines[key] = make();
			return lines[key];
		};
		(input.dinners || []).forEach(function (d) {
			const r = input.recipes && input.recipes[d.recipeId];
			if (!r) return;
			(r.ingredients || []).forEach(function (ing) {
				if (ing.staple) return;
				const item = String(ing.item || "").trim();
				if (!item) return;
				const key = itemKey(item);
				const line = add(key, function () { return { key: key, names: [], totals: {}, loose: false, sections: {}, from: [], source: "dinner" }; });
				line.names.push(item);
				const unit = String(ing.unit || "").toLowerCase();
				let q = typeof ing.qty === "number" && isFinite(ing.qty) ? ing.qty : null;
				if (q === null) line.loose = true;
				else {
					if (ing.scale !== false && r.servings > 0 && r.servings !== household) q = Scale.roundQty(q * household / r.servings, unit);
					const u = unit === "kg" ? "g" : unit === "l" ? "ml" : unit;
					if (unit === "kg" || unit === "l") q *= 1000;
					line.totals[u] = (line.totals[u] || 0) + q;
				}
				const sec = String(ing.section || "").trim();
				if (sec) line.sections[sec] = (line.sections[sec] || 0) + 1;
				const name = shortName(r);
				if (line.from.indexOf(name) === -1) line.from.push(name);
			});
		});
		(input.regulars || []).forEach(function (g) {
			const item = String(g.item || "").trim();
			if (!item) return;
			const key = itemKey(item);
			const line = add(key, function () { return { key: key, names: [], totals: {}, loose: false, sections: {}, from: [], source: "regular" }; });
			line.names.unshift(item);
			line.regular = true; // bought every week: never a "check the cupboard"
			if (g.qty !== undefined && String(g.qty).trim() !== "") line.extra = String(g.qty).trim();
			if (g.section) line.sections[g.section] = (line.sections[g.section] || 0) + 100; // the regulars tab says where it is
			line.from.push("Every week");
		});
		(input.added || []).forEach(function (g) {
			const item = String(g.item || "").trim();
			if (!item) return;
			const key = itemKey(item);
			const line = add(key, function () { return { key: key, names: [], totals: {}, loose: false, sections: {}, from: [], source: "added" }; });
			if (!line.names.length) line.names.push(item);
			if (g.qty !== undefined && String(g.qty).trim() !== "") line.extra = String(g.qty).trim();
			if (g.section) line.sections[g.section] = (line.sections[g.section] || 0) + 1000;
			if (line.source !== "added") line.alsoAdded = true;
			if (line.from.indexOf("Added") === -1) line.from.push("Added");
		});

		const unticked = {}, ticked = {}, own = {}, got = {};
		(input.got || []).forEach(function (k) { got[itemKey(k)] = true; }); // bought already (crossed off in the shop)
		Object.keys(input.qtys || {}).forEach(function (k) { const v = String(input.qtys[k] || "").trim(); if (v) own[itemKey(k)] = v; });
		(input.unticked || []).forEach(function (k) { unticked[itemKey(k)] = true; });
		(input.ticked || []).forEach(function (k) { ticked[itemKey(k)] = true; });
		const rules = orderRules(input.order);
		const sections = (input.sections || []).slice().sort(function (a, b) { return (Number(a.order) || 999) - (Number(b.order) || 999); });
		const known = {};
		sections.forEach(function (s) { known[plain(s.name)] = s.name; });

		const items = Object.keys(lines).map(function (key) {
			const line = lines[key];
			// the section most of its rows give, spelt as on the Shop sections tab
			let section = OTHER, most = 0;
			Object.keys(line.sections).forEach(function (s) { if (line.sections[s] > most) { most = line.sections[s]; section = known[plain(s)] || s; } });
			// a plural name when there's more than one
			const units = Object.keys(line.totals);
			const parts = units.sort().map(function (u) {
				let q = line.totals[u];
				if (WHOLE.indexOf(u) !== -1) q = Math.ceil(q - 1e-9);
				return { q: q, u: u };
			});
			const many = units.length !== 1 || units[0] !== "" || line.totals[""] > 1;
			const plural = line.names.filter(function (n) { return /s$/i.test(n); })[0];
			let name = line.names[0] || key;
			if (!many) name = Scale.singular(name);
			else if (plural && line.source === "dinner") name = plural;
			const auto = qtyOf(parts, line.extra);
			const mine = own[key]; // an amount you changed it to, e.g. 1 bag of carrots, not 3 carrots
			const label = mine ? ownLabel(capital(name), mine) : labelOf(capital(name), parts, line.extra);
			// a spoonful of soy sauce: on the list to check, but not ticked unless you tick it
			const check = line.source === "dinner" && !line.alsoAdded && !line.regular && smallAmount(parts);
			const place = placeOf(key, section, rules);
			return {
				key: key,
				name: capital(name),
				qty: mine ? ownQty(mine) : auto,
				own: mine || "",
				auto: auto,
				label: label,
				section: section,
				from: line.from.join(", "),
				source: line.source,
				check: check,
				added: line.source === "added" || Boolean(line.alsoAdded),
				ticked: check ? Boolean(ticked[key]) : !unticked[key],
				got: Boolean(got[key]),
				group: place[0] + ":" + place[1],
				place: place
			};
		});

		const order = sections.map(function (s) { return s.name; });
		if (items.some(function (x) { return order.indexOf(x.section) === -1; })) {
			items.forEach(function (x) { if (order.indexOf(x.section) === -1 && x.section !== OTHER) order.push(x.section); });
			order.push(OTHER);
		}
		const groups = order.map(function (name) {
			const s = sections.filter(function (x) { return x.name === name; })[0];
			return {
				name: name,
				block: isBlock(s || { name: name }),
				items: items.filter(function (x) { return x.section === name; }).sort(function (a, b) {
					for (let i = 0; i < 3; i++) if (a.place[i] !== b.place[i]) return a.place[i] - b.place[i];
					return a.name.localeCompare(b.name);
				})
			};
		}).filter(function (g) { return g.items.length || g.name !== OTHER; });
		groups.forEach(function (g) { g.items.forEach(function (x) { delete x.place; }); });
		const toBuy = items.filter(function (x) { return x.ticked; });
		return {
			groups: groups,
			count: toBuy.filter(function (x) { return !x.got; }).length, // still to get
			gotCount: toBuy.filter(function (x) { return x.got; }).length
		};
	}

	/** Bread and Tesco go across the page below the aisles; the On paper column can say otherwise. */
	function isBlock(s) {
		const v = plain(s.onPaper);
		if (v === "block" || v === "row" || v === "across") return true;
		if (v === "column") return false;
		return /bread|back wall|tesco|other/i.test(s.name || "");
	}

	/**
	 * The printed page: aisle columns, then each block (Bread, Tesco) across the page in 4
	 * columns. Only ticked items. A line is { text, gap } (gap: a new Shop order group starts);
	 * every column ends with 2 blank lines, and the page fills shorter columns with more
	 * blank lines down to the bottom of the longest.
	 */
	function paper(list) {
		const ticked = function (g) {
			let last = null;
			return g.items.filter(function (x) { return x.ticked && !x.got; }).map(function (x, i) {
				const line = { text: x.label, gap: i > 0 && x.group !== last };
				last = x.group;
				return line;
			});
		};
		const blank = function () { return { text: "", gap: false }; };
		const columns = list.groups.filter(function (g) { return !g.block; }).map(function (g) {
			return { name: g.name, lines: ticked(g).concat([blank(), blank()]) };
		});
		const blocks = list.groups.filter(function (g) { return g.block; }).map(function (g) {
			const lines = ticked(g).map(function (l) { return { text: l.text, gap: false }; });
			if (!lines.length) return null; // nothing for Bread or Tesco this time: leave it off the page
			const fill = Math.max(4, Math.ceil(lines.length / 4) * 4);
			while (lines.length < fill) lines.push(blank());
			return { name: g.name, lines: lines };
		}).filter(Boolean);
		return { columns: columns, blocks: blocks };
	}

	const api = { itemKey, buildList, paper, plain, shortName, OTHER };
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	else root.FridgeShop = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
