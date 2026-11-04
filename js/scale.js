/* Scaling ingredient amounts from a recipe's servings to the household's.
 * Shared rules (the phone app will use the same file later):
 *  - lines marked "don't scale" (a tin, a pack) stay as written
 *  - whole items round to the nearest half, never below a half
 *  - grams and millilitres round to the nearest 25 (nearest 5 under 50)
 *  - spoons round to the nearest quarter
 * Works in Node (require) and as a plain script (globalThis.FridgeScale). */
"use strict";

(function (root) {
	const METRIC = ["g", "ml"];
	const BIG_METRIC = ["kg", "l"];
	const SPOONS = ["tsp", "tbsp"];
	const NO_SPACE = ["g", "kg", "ml", "l"];
	const FRACTIONS = { 0.25: "¼", 0.5: "½", 0.75: "¾" };

	function roundTo(x, step) {
		return Math.round(x / step) * step;
	}

	function roundQty(q, unit) {
		if (METRIC.includes(unit)) return q < 50 ? Math.max(5, roundTo(q, 5)) : roundTo(q, 25);
		if (BIG_METRIC.includes(unit) || SPOONS.includes(unit)) return Math.max(0.25, roundTo(q, 0.25));
		if (q >= 10) return Math.round(q);
		return Math.max(0.5, roundTo(q, 0.5));
	}

	/** 1.5 -> "1½", 0.25 -> "¼", 12 -> "12", 2.2 -> "2.2" */
	function formatQty(q) {
		if (q === null || q === undefined) return "";
		const whole = Math.floor(q + 1e-9);
		const frac = Math.round((q - whole) * 100) / 100;
		if (frac === 0) return String(whole);
		if (FRACTIONS[frac]) return (whole ? String(whole) : "") + FRACTIONS[frac];
		return String(Math.round(q * 10) / 10);
	}

	/** "sweet potatoes" -> "sweet potato" when there's only one (only for unit-less items). */
	function singular(item) {
		const words = item.split(" ");
		const last = words.pop();
		let s = last;
		if (/oes$/i.test(last)) s = last.slice(0, -2);
		else if (/ies$/i.test(last)) s = last.slice(0, -3) + "y";
		else if (/(ches|shes|xes)$/i.test(last)) s = last.slice(0, -2);
		else if (/[^s]s$/i.test(last)) s = last.slice(0, -1);
		return words.concat(s).join(" ");
	}

	/**
	 * @param {{qty:number|null, unit:string, item:string, prep:string, scale:boolean}} ing
	 * @returns {{amount:string, item:string, prep:string, scaled:boolean}}
	 */
	function scaleIngredient(ing, fromServings, toServings) {
		const unit = String(ing.unit || "").toLowerCase();
		let qty = typeof ing.qty === "number" && isFinite(ing.qty) ? ing.qty : null;
		let scaled = false;
		if (qty !== null && ing.scale !== false && fromServings > 0 && toServings > 0 && fromServings !== toServings) {
			qty = roundQty(qty * toServings / fromServings, unit);
			scaled = true;
		}
		let item = String(ing.item || "");
		if (qty !== null && qty <= 1 && !unit) item = singular(item);
		let amount = "";
		if (qty !== null) {
			const unitText = !unit ? "" : unit === "tin" || unit === "carton" || unit === "pack" || unit === "jar" || unit === "bunch" || unit === "slice"
				? " " + unit + (qty > 1 ? "s" : "")
				: (NO_SPACE.includes(unit) ? "" : " ") + unit;
			amount = formatQty(qty) + unitText;
		}
		return { amount, item, prep: String(ing.prep || ""), scaled };
	}

	const api = { scaleIngredient, roundQty, formatQty, singular };
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	else root.FridgeScale = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
