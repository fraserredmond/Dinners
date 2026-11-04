/* Dinners - the phone app. Plain script, no build step. It talks to the Dinner recipes
 * Sheet's Apps Script web app (doPost in Code.gs); the URL and secret stay on this phone. */
"use strict";

/* ---------------- talking to the Sheet ---------------- */
/* Settings live only on this phone (localStorage): the web app URL and the secret. */
var SETTINGS_KEY = "dinners.settings";
function getSettings() {
	try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {}; } catch (e) { return {}; }
}
function saveSettings(s) {
	try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* private window */ }
}
var badgeName = "";

/**
 * Asks the Sheet's web app for something: a POST with a text/plain JSON body,
 * which keeps the browser from sending a CORS preflight that Apps Script can't answer.
 */
function call(action, extra) {
	var s = getSettings();
	if (!s.url || !s.secret) return Promise.reject(Object.assign(new Error("This phone isn't set up yet."), { code: "NO_SETUP" }));
	var body = Object.assign({ secret: s.secret, action: action }, extra || {});
	var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
	var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 45000);
	return fetch(s.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow", signal: ctrl ? ctrl.signal : undefined })
		.catch(function () { throw Object.assign(new Error("Couldn't reach the Sheet. Check the phone's internet connection."), { code: "NETWORK" }); })
		.then(function (res) {
			return res.json().catch(function () { throw Object.assign(new Error("The Sheet's web app sent something unexpected. Is the web app URL right?"), { code: "BAD_RESPONSE" }); });
		})
		.then(function (j) {
			if (!j || !j.ok) throw Object.assign(new Error((j && j.message) || "Something went wrong"), { code: (j && j.error) || "UNKNOWN" });
			if (j.data && j.data.badge) { badgeName = j.data.badge; try { localStorage.setItem("dinners.badge", badgeName); } catch (e) { /* ignore */ } }
			return j.data;
		})
		.finally(function () { clearTimeout(timer); });
}
try { badgeName = localStorage.getItem("dinners.badge") || ""; } catch (e) { badgeName = ""; }
function badgeText(extra) { return "\u2713 " + (badgeName || "Marked") + (extra || ""); }

/* ---------------- small helpers ---------------- */
var ICONS = {
	week: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
	recipes: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h8M8 13h6"/></svg>',
	shopping: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.4 11h11l2-8H6.2"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/></svg>',
	back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
	edit: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
	cog: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
	swap: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>'
};

/** el("div", { class: "x", onclick: fn }, child, "text", ...) - text is never parsed as HTML */
function el(tag, attrs) {
	var e = document.createElement(tag);
	attrs = attrs || {};
	Object.keys(attrs).forEach(function (k) {
		var v = attrs[k];
		if (v === null || v === undefined || v === false) return;
		if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
		else if (k === "html") e.innerHTML = v; // only our own fixed icon markup
		else e.setAttribute(k, v === true ? "" : v);
	});
	for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
	return e;
}
function add(parent, c) {
	if (c === null || c === undefined || c === false) return;
	if (Array.isArray(c)) { c.forEach(function (x) { add(parent, x); }); return; }
	parent.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
}
/** A photo that hides itself if it can't load. */
function photo(src, alt) {
	return el("img", { src: src, alt: alt || "", onerror: function (e) { e.target.remove(); } });
}
function icon(name) { return el("span", { html: ICONS[name], style: "display:inline-flex" }); }
function chips(r, withCarbs) {
	return el("div", { class: "chips" },
		r.beth ? el("span", { class: "chip beth" }, badgeText()) : null,
		r.minutes ? el("span", { class: "chip" }, r.minutes + " min") : null,
		withCarbs && r.carbsPer100g !== null && r.carbsPer100g !== undefined ? el("span", { class: "chip carbs" }, r.carbsPer100g + "g carbs per 100g") : null);
}
var toastTimer;
function toast(text) {
	var t = document.getElementById("toast");
	t.textContent = text;
	t.classList.remove("hidden");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(function () { t.classList.add("hidden"); }, 2800);
}
function loading(where) { where.textContent = ""; where.appendChild(el("div", { class: "loading" }, "Loading\u2026")); }
function showError(where, err, retry) {
	var setup = err && (err.code === "BAD_SECRET" || err.code === "NO_SETUP" || err.code === "BAD_RESPONSE");
	where.textContent = "";
	where.appendChild(el("div", { class: "error", role: "alert" },
		el("b", null, setup ? "This phone needs setting up" : "Something went wrong"),
		el("div", null, (err && err.message) || String(err)),
		setup ? el("button", { class: "btn", type: "button", onclick: function () { go("settings"); } }, "Open settings")
			: retry ? el("button", { class: "btn", type: "button", onclick: retry }, "Try again") : null));
}
var wide = window.matchMedia("(min-width: 1000px)");

/* ---------------- screens and moving between them ---------------- */
var main = document.getElementById("main");
var side = document.getElementById("side");
var current = { name: "week", args: {} };
var cache = { week: null };

var stack = [];
function hashFor(name, args) {
	var keys = Object.keys(args || {}).filter(function (k) { return args[k] !== "" && args[k] !== null && args[k] !== undefined; });
	return "#" + name + (keys.length ? "?" + keys.map(function (k) { return k + "=" + encodeURIComponent(args[k]); }).join("&") : "");
}
function go(name, args, replace) {
	current = { name: name, args: args || {} };
	if (replace && stack.length) stack[stack.length - 1] = current; else stack.push(current);
	if (stack.length > 30) stack.shift();
	try { history[replace ? "replaceState" : "pushState"](current, "", hashFor(name, args)); } catch (e) { /* ignore */ }
	show();
}

/** The app's own Back button: the previous screen, or This week. */
function back() {
	stack.pop();
	var prev = stack.pop() || { name: "week", args: {} };
	go(prev.name, prev.args);
}

/** The phone's Back button or gesture. */
window.addEventListener("popstate", function (e) {
	current = e.state && e.state.name ? e.state : parseHash(location.hash);
	stack.pop();
	show();
});

function renderNav() {
	var sections = [["week", "Week"], ["recipes", "Recipes"], ["shopping", "Shopping"], ["settings", "Settings"]];
	var section = current.name === "recipes" ? "recipes" : current.name === "shopping" ? "shopping" : "week";
	["tabs", "topnav"].forEach(function (id) {
		var n = document.getElementById(id);
		n.textContent = "";
		sections.forEach(function (s) {
			if (id === "tabs" && s[0] === "settings") return;
			n.appendChild(el("button", { type: "button", "aria-current": section === s[0] ? "page" : null, onclick: function () { go(s[0]); } },
				id === "tabs" ? icon(s[0]) : null, s[1]));
		});
	});
}

function show() {
	renderNav();
	main.classList.toggle("plain", false);
	window.scrollTo(0, 0);
	var a = current.args;
	if (wide.matches) renderSide();
	if (current.name === "recipe") return screenRecipe(a.id, a.day);
	if (current.name === "edit") return screenEdit(a.id, a.day);
	if (current.name === "swap") return screenSwap(a.day);
	if (current.name === "recipes") return screenRecipes();
	if (current.name === "shopping") return screenShopping();
	if (current.name === "settings") return screenSettings();
	if (!getSettings().url) return screenSettings(true);
	return screenWeek();
}
wide.addEventListener("change", show);

/* ---------------- This week ---------------- */
function loadWeek(force) {
	if (cache.week && !force) return Promise.resolve(cache.week);
	return call("week", { offset: 0 }).then(function (w) { cache.week = w; return w; });
}

function dayRow(d, w, compact) {
	var din = d.dinner;
	var cls = "day" + (d.isToday ? " today" : d.isPast ? " past" : "") + (!din ? " empty" : din.kind === "nocook" ? " nocook" : "");
	var open = function () {
		if (din && din.recipeId) go("recipe", { id: din.recipeId, day: d.key });
		else if (!d.isPast) go("swap", { day: d.key });
	};
	var label = !din ? (d.isPast ? "\u2014" : "Nothing planned") : din.title;
	return el("button", { type: "button", class: cls, onclick: open, disabled: d.isPast && !(din && din.recipeId) ? true : null },
		el("div", { class: "when" }, el("b", null, d.dow), el("br"), d.num),
		el("div", { class: "what" },
			d.isToday ? el("div", { class: "eyebrow", style: "font-size:13px" }, "Tonight") : null,
			el("div", { class: "meal" }, label, din && din.kind === "other" ? el("span", { class: "small", style: "font-weight:400" }, " (no recipe)") : null),
			d.isToday && din && din.recipeId ? chips(din, false) : null),
		d.isToday && w.tonightPhoto && !compact ? photo(w.tonightPhoto) : null,
		!d.isToday && !d.isPast ? el("span", { class: "hint" }, din && din.recipeId ? "" : "Choose") : null);
}

function weekList(w, compact) {
	return el("div", { class: "days" }, w.days.map(function (d) { return dayRow(d, w, compact); }),
		el("div", { class: "next" },
			el("b", null, w.nextWeek.planned ? "Next week: " + w.nextWeek.planned + " of 7 nights in the calendar" : "Next week isn't planned yet"),
			el("span", { class: "small muted" }, w.nextWeek.range + " \u00b7 Planning from suggestions comes in the next update")));
}

function screenWeek() {
	loading(main);
	loadWeek(true).then(function (w) {
		if (current.name !== "week") return;
		if (wide.matches) {
			renderSide();
			var t = w.days.filter(function (d) { return d.isToday; })[0];
			if (t && t.dinner && t.dinner.recipeId) return screenRecipe(t.dinner.recipeId, t.key, true);
			main.textContent = "";
			main.appendChild(el("div", { class: "stack" }, el("h1", null, "Pick a day"), el("p", { class: "muted" }, "Choose a dinner on the left to see its recipe.")));
			return;
		}
		main.textContent = "";
		add(main, [
			el("div", { class: "stack", style: "gap:4px" },
				el("div", { class: "eyebrow" }, "This week"),
				el("div", { class: "row", style: "align-items:baseline" }, el("h1", null, "Dinners"), el("span", { class: "small muted" }, w.range))),
			el("button", { type: "button", class: "cog", "aria-label": "Settings", onclick: function () { go("settings"); }, html: ICONS.cog }),
			weekList(w, false)
		]);
	}).catch(function (e) { showError(main, e, screenWeek); });
}

function renderSide() {
	loadWeek(false).then(function (w) {
		side.textContent = "";
		add(side, [el("div", { class: "sidehead" }, "This week \u00b7 " + w.range), weekList(w, true)]);
	}).catch(function () { side.textContent = ""; });
}

/* ---------------- a recipe ---------------- */
function screenRecipe(id, dayKey, inWeek) {
	loading(main);
	call("recipe", { id: id, day: dayKey || null }).then(function (r) {
		var servings = r.household;
		var ingList = el("div", { class: "ings" });
		var count = el("div", { class: "count" });
		var note = el("div", { class: "small muted" });
		var heading = el("div", { style: "font-weight:700" });
		var draw = function () {
			count.textContent = servings;
			heading.textContent = "Cooking for " + servings;
			note.textContent = servings === r.household ? "Same as the fridge" : "Just for now \u00b7 the fridge still shows " + r.household;
			ingList.textContent = "";
			r.ingredients.forEach(function (i) {
				var s = FridgeScale.scaleIngredient(i, r.servings, servings);
				ingList.appendChild(el("div", { class: "ing" }, el("div", { class: "amt" }, s.amount), el("div", null, s.item, s.prep ? el("span", { class: "prep" }, ", " + s.prep) : null)));
			});
		};
		draw();
		var day = r.day;
		var whenText = day ? (day.isToday ? "Tonight" : day.label) : "";
		main.textContent = "";
		add(main, [
			!inWeek ? el("button", { type: "button", class: "back", onclick: back }, icon("back"), "Back") : null,
			whenText ? el("div", { class: "eyebrow" }, whenText) : null,
			el("div", { class: "rhead" },
				el("div", { class: "words" }, el("h1", null, r.title), chips(r, true)),
				r.photo ? photo(r.photo) : null),
			el("section", { class: "servings", "aria-label": "Servings" },
				el("div", { class: "stack", style: "gap:2px" }, heading, note),
				el("div", { style: "display:flex;align-items:center;gap:10px" },
					el("button", { type: "button", class: "round", "aria-label": "One fewer", onclick: function () { if (servings > 1) { servings--; draw(); } } }, "\u2212"),
					count,
					el("button", { type: "button", class: "round dark", "aria-label": "One more", onclick: function () { if (servings < 20) { servings++; draw(); } } }, "+"))),
			el("div", { class: "two" },
				el("section", { class: "stack" }, el("h2", null, "Ingredients"), ingList),
				el("section", { class: "stack method" }, el("h2", null, "Method"),
					el("ol", { class: "method" }, r.method.map(function (step, n) {
						return el("li", null, el("span", { class: "n" }, n + 1), el("span", null, step));
					})))),
			r.notes || r.lastHad ? el("section", { class: "notes" },
				el("h2", { style: "color:var(--accenttext)" }, "Notes"),
				r.notes ? el("div", null, r.notes) : null,
				r.lastHad ? el("div", { class: "small muted" }, r.lastHad) : null) : null,
			el("div", { class: "stack" },
				el("button", { type: "button", class: "btn", onclick: function () { go("edit", { id: r.id, day: day ? day.key : "" }); } }, icon("edit"), "Edit time, notes or photo"),
				day && (day.isToday || day.key > todayKey()) ? el("button", { type: "button", class: "btn primary", onclick: function () { go("swap", { day: day.key }); } }, icon("swap"), "Swap " + day.label + "'s dinner") : null)
		]);
	}).catch(function (e) { showError(main, e, function () { screenRecipe(id, dayKey, inWeek); }); });
}

function todayKey() {
	var t = cache.week && cache.week.days.filter(function (d) { return d.isToday; })[0];
	if (t) return t.key;
	var d = new Date();
	return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* ---------------- quick edit ---------------- */
function screenEdit(id, dayKey) {
	loading(main);
	call("recipe", { id: id }).then(function (r) {
		var minutes = r.minutes || 30;
		var newPhoto = null;
		var mins = el("input", { id: "mins", class: "field mins", type: "number", inputmode: "numeric", min: "1", max: "600", value: String(minutes) });
		var notes = el("textarea", { id: "notes", class: "field", rows: "5" });
		notes.value = r.notes || "";
		var pic = r.photo ? el("img", { src: r.photo, alt: "Current photo" }) : el("div", { class: "nophoto" }, "No photo yet");
		var picWrap = el("div", null, pic);
		var step = function (n) { var v = Math.max(5, Math.round((Number(mins.value) || minutes) / 5) * 5 + n); mins.value = String(v); };
		var pick = function (capture) {
			var input = el("input", { type: "file", accept: "image/*", capture: capture ? "environment" : null, "aria-label": capture ? "Take a photo" : "Choose a photo" });
			input.addEventListener("change", function () {
				var f = input.files && input.files[0];
				if (!f) return;
				shrinkPhoto(f).then(function (dataUrl) {
					newPhoto = dataUrl;
					picWrap.textContent = "";
					picWrap.appendChild(el("img", { src: dataUrl, alt: "New photo" }));
				}).catch(function () { toast("That photo couldn't be read"); });
			});
			return input;
		};
		var save = el("button", { type: "button", class: "btn primary" }, "Save");
		save.addEventListener("click", function () {
			save.disabled = true;
			save.textContent = "Saving\u2026";
			call("saveEdit", { id: r.id, changes: { minutes: Number(mins.value), notes: notes.value, photo: newPhoto } }).then(function () {
				toast("Saved. The fridge updates within 15 minutes.");
				go("recipe", { id: r.id, day: dayKey || "" }, true);
			}).catch(function (e) {
				save.disabled = false;
				save.textContent = "Save";
				toast(e.message || "Couldn't save");
			});
		});
		main.textContent = "";
		add(main, [
			el("button", { type: "button", class: "back", onclick: back }, icon("back"), "Cancel"),
			el("h1", { style: "font-size:24px" }, r.title),
			el("section", { class: "card stack" },
				el("label", { class: "lab", for: "mins" }, "How long it really takes"),
				el("div", { style: "display:flex;align-items:center;gap:12px" },
					el("button", { type: "button", class: "round", "aria-label": "5 minutes less", onclick: function () { step(-5); } }, "\u2212"),
					mins,
					el("button", { type: "button", class: "round dark", "aria-label": "5 minutes more", onclick: function () { step(5); } }, "+"),
					el("span", { class: "muted" }, "minutes"))),
			el("section", { class: "card stack" }, el("label", { class: "lab", for: "notes" }, "Notes"), notes),
			el("section", { class: "card stack" },
				el("div", { class: "lab" }, "Photo"),
				el("div", { class: "photoedit" }, picWrap,
					el("div", { class: "stack", style: "flex:1;gap:8px" },
						el("div", { class: "btn filebtn", style: "min-height:44px;font-size:16px" }, "Take a photo", pick(true)),
						el("div", { class: "btn filebtn", style: "min-height:44px;font-size:16px;border-color:var(--line);font-weight:400" }, "Choose from phone", pick(false))))),
			save,
			el("p", { class: "small muted", style: "margin:0" }, "Ingredients and method are changed in the Dinner recipes Sheet, so the amounts stay in one place.")
		]);
	}).catch(function (e) { showError(main, e, function () { screenEdit(id, dayKey); }); });
}

/** Phone photos are big: shrink to fit 640px and save as JPEG. */
function shrinkPhoto(file) {
	return new Promise(function (resolve, reject) {
		var img = new Image();
		var url = URL.createObjectURL(file);
		img.onload = function () {
			var s = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight));
			var c = document.createElement("canvas");
			c.width = Math.round(img.naturalWidth * s);
			c.height = Math.round(img.naturalHeight * s);
			c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
			URL.revokeObjectURL(url);
			resolve(c.toDataURL("image/jpeg", 0.72));
		};
		img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("bad image")); };
		img.src = url;
	});
}

/* ---------------- swap a day ---------------- */
function screenSwap(dayKey) {
	loading(main);
	Promise.all([call("swapOptions", { day: dayKey }), call("recipes")]).then(function (res) {
		var o = res[0], all = res[1].recipes;
		var busy = false;
		var done = function (p, msg) {
			if (busy) return;
			busy = true;
			main.style.opacity = "0.6";
			p.then(function () {
				cache.week = null;
				toast(msg);
				go("week", {}, true);
			}).catch(function (e) {
				busy = false;
				main.style.opacity = "";
				toast(e.message || "Couldn't save");
			});
		};
		var put = function (r) { return function () { done(call("setDinner", { day: dayKey, choice: { recipeId: r.id } }), r.title + " is on " + o.day.label); }; };
		var results = el("div", { class: "stack" });
		var search = el("input", { id: "find", class: "field", type: "search", placeholder: "Type a name, e.g. soup", autocomplete: "off" });
		search.addEventListener("input", function () {
			var q = search.value.trim().toLowerCase();
			results.textContent = "";
			if (q.length < 2) return;
			var hits = all.filter(function (r) { return r.title.toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
			if (!hits.length) results.appendChild(el("div", { class: "small muted" }, "No recipe matches \u201c" + search.value.trim() + "\u201d"));
			hits.forEach(function (r) { results.appendChild(pickCard(r, r.minutes ? r.minutes + " min" : "", put(r))); });
		});
		main.textContent = "";
		add(main, [
			el("button", { type: "button", class: "back", onclick: back }, icon("back"), "Cancel"),
			el("h1", { style: "font-size:24px" }, "Swap " + o.day.label),
			el("div", { class: "muted" }, "Now: ", el("b", { style: "color:var(--text)" }, o.now ? o.now.title : "nothing planned")),
			o.suggestions.length ? el("section", { class: "stack" }, el("h2", null, "Suggestions"),
				o.suggestions.map(function (r) { return pickCard(r, (r.minutes ? r.minutes + " min \u00b7 " : "") + r.why, put(r)); })) : null,
			el("section", { class: "stack" }, el("label", { for: "find", class: "lab", style: "font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)" }, "Or find a recipe"), search, results),
			el("section", { class: "stack" }, el("h2", null, "No cooking"),
				el("div", { class: "grid3" }, o.noCooking.map(function (n) {
					return el("button", { type: "button", onclick: function () { done(call("setDinner", { day: dayKey, choice: { noCooking: n } }), n + " on " + o.day.label); } }, n);
				}))),
			el("section", { class: "stack" }, el("h2", null, "Swap with another day"),
				el("div", { class: "list" }, o.others.filter(function (x) { return !x.isPast; }).map(function (x) {
					return el("button", { type: "button", onclick: function () { done(call("swapDays", { dayA: dayKey, dayB: x.key }), "Swapped " + o.day.label + " and " + x.label); } },
						el("b", null, x.label), el("span", { class: x.title ? "" : "muted" }, x.title || "Nothing planned"));
				}))),
			el("p", { class: "small muted", style: "margin:0" }, "Your choice goes straight into the Dinners calendar and onto the fridge.")
		]);
	}).catch(function (e) { showError(main, e, function () { screenSwap(dayKey); }); });
}

function pickCard(r, sub, onclick) {
	return el("button", { type: "button", class: "pick", onclick: onclick },
		r.photo ? photo(r.photo) : el("div", { class: "ph" }),
		el("div", { class: "stack", style: "gap:3px;flex:1;min-width:0" },
			el("div", { class: "t" }, r.title),
			el("div", { class: "small muted" }, r.beth ? el("b", { style: "color:var(--beth)" }, badgeText(" \u00b7 ")) : null, sub)));
}

/* ---------------- all recipes ---------------- */
function screenRecipes() {
	loading(main);
	call("recipes").then(function (res) {
		var bethOnly = false;
		var list = el("div", { class: "list" });
		var search = el("input", { id: "rsearch", class: "field", type: "search", placeholder: "Search recipes", autocomplete: "off" });
		var bethBtn = el("button", { type: "button", class: "toggle", "aria-pressed": "false" }, badgeText(" only"));
		var draw = function () {
			var q = search.value.trim().toLowerCase();
			var rows = res.recipes.filter(function (r) { return (!bethOnly || r.beth) && (!q || r.title.toLowerCase().indexOf(q) !== -1); });
			list.textContent = "";
			if (!rows.length) list.appendChild(el("div", { class: "small muted", style: "padding:14px 0" }, "No recipes match."));
			rows.forEach(function (r) {
				list.appendChild(el("button", { type: "button", onclick: function () { go("recipe", { id: r.id }); } },
					el("span", { style: "font-weight:700" }, r.title),
					el("span", { class: "small muted", style: "flex:none" }, r.beth ? el("b", { style: "color:var(--beth)" }, badgeText("  ")) : null, r.minutes ? r.minutes + " min" : "")));
			});
		};
		search.addEventListener("input", draw);
		bethBtn.addEventListener("click", function () { bethOnly = !bethOnly; bethBtn.setAttribute("aria-pressed", String(bethOnly)); draw(); });
		draw();
		main.textContent = "";
		add(main, [
			el("div", { class: "row", style: "align-items:baseline" }, el("h1", null, "Recipes"), el("span", { class: "small muted" }, res.recipes.length + " in the Sheet")),
			el("label", { for: "rsearch", class: "hidden" }, "Search recipes"),
			search,
			el("div", null, bethBtn),
			list
		]);
	}).catch(function (e) { showError(main, e, screenRecipes); });
}

/* ---------------- shopping (next update) ---------------- */
function screenShopping() {
	main.textContent = "";
	add(main, [
		el("h1", null, "Shopping"),
		el("div", { class: "card stack" },
			el("b", null, "The shopping list comes in a later update."),
			el("span", { class: "muted" }, "It will be built from the week's dinners plus your regular items, grouped the way you walk round the shop, ready to print."))
	]);
}

/* ---------------- settings ---------------- */
function screenSettings(first) {
	var s = getSettings();
	var url = el("input", { id: "url", class: "field", type: "url", inputmode: "url", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "https://script.google.com/macros/s/.../exec" });
	var secret = el("input", { id: "secret", class: "field", type: "password", autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
	url.value = s.url || "";
	secret.value = s.secret || "";
	var status = el("div", { class: "small", role: "status" });
	var save = el("button", { type: "button", class: "btn primary" }, "Save and test");
	save.addEventListener("click", function () {
		saveSettings({ url: url.value.trim(), secret: secret.value.trim() });
		status.textContent = "Testing\u2026";
		call("ping").then(function () {
			status.textContent = "Connected.";
			cache.week = null;
			toast("Connected to the Sheet");
			go("week", {}, true);
		}).catch(function (e) { status.textContent = e.message; });
	});
	main.textContent = "";
	add(main, [
		!first ? el("button", { type: "button", class: "back", onclick: back }, icon("back"), "Back") : null,
		el("h1", null, first ? "Set up this phone" : "Settings"),
		el("p", { class: "muted", style: "margin:0" }, "The easiest way: in the Dinner recipes Sheet, use Fridge > Phone app setup link, send the link to this phone and open it. Or paste the two values here."),
		el("section", { class: "card stack" },
			el("label", { class: "lab", for: "url" }, "Web app URL"), url,
			el("label", { class: "lab", for: "secret" }, "Secret"), secret),
		save, status
	]);
}

/** A setup link: #setup=<base64 of {url, secret}>. Stored on this phone, then removed from the address. */
function takeSetupLink() {
	var m = /[#&]setup=([A-Za-z0-9_-]+)/.exec(location.hash);
	if (!m) return false;
	try {
		var b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
		while (b64.length % 4) b64 += "=";
		var v = JSON.parse(atob(b64));
		if (v && /^(https:\/\/script\.google\.com\/|http:\/\/localhost:)/.test(v.url) && v.secret) {
			saveSettings({ url: v.url, secret: v.secret });
			setTimeout(function () { toast("This phone is set up. Add it to your home screen."); }, 300);
		}
	} catch (e) { /* not a valid link */ }
	try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ }
	return true;
}

/* ---------------- start ---------------- */
function parseHash(hash) {
	var m = /^#?([a-z]+)(?:\?(.*))?$/.exec(hash || "");
	var args = {};
	if (m && m[2]) m[2].split("&").forEach(function (p) { var kv = p.split("="); args[kv[0]] = decodeURIComponent(kv[1] || ""); });
	return { name: m ? m[1] : "week", args: args };
}
// a setup link opened while the app is already open in this tab
window.addEventListener("hashchange", function () {
	if (/[#&]setup=/.test(location.hash) && takeSetupLink()) { cache.week = null; go("week", {}, true); }
});
takeSetupLink();
var first = parseHash(location.hash);
go(first.name, first.args, true);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(function () { /* fine without */ });
