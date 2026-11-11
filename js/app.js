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

/* ---------------- quick screens: the last copy at once, then the fresh one ----------------
 * Each answer from the Sheet is kept on this phone. A screen shows the kept copy straight away
 * and swaps in the new one when the Sheet answers (a few seconds), if anything changed. */
var STORE = "dinners.c.";
var screenToken = 0; // goes up on every screen change, so a late answer doesn't draw over another screen

function storeKey(action, extra) { return STORE + action + ":" + JSON.stringify(extra || {}); }
/** A kept answer and when it came from the Sheet: { at (ms, or null if not known), data } */
function storeEntry(key) {
	try {
		var v = localStorage.getItem(key);
		if (!v) return null;
		var o = JSON.parse(v);
		return o && o.v === 2 ? { at: o.at, data: o.data } : { at: null, data: o };
	} catch (e) { return null; }
}
function storeGet(key) { var e = storeEntry(key); return e ? e.data : null; }
function storePut(key, data, at) {
	var text = JSON.stringify({ v: 2, at: at || Date.now(), data: data });
	try { localStorage.setItem(key, text); } catch (e) {
		storeForget(["recipe"]); // full: recipes are the biggest and the easiest to fetch again
		try { localStorage.setItem(key, text); } catch (e2) { /* fine: it's only a speed-up */ }
	}
}
/** Forgets kept answers: all of them, or those for some actions ("week", 'recipe:{"id":"x"'). */
function storeForget(prefixes) {
	try {
		Object.keys(localStorage).forEach(function (k) {
			if (k.indexOf(STORE) !== 0) return;
			if (!prefixes || prefixes.some(function (p) { return k.indexOf(STORE + p + (p.indexOf(":") === -1 ? ":" : "")) === 0; })) localStorage.removeItem(k);
		});
	} catch (e) { /* nothing kept */ }
}
/** After any change to the dinners: the kept week, plan and shopping list are out of date. */
function changed() {
	cache.week = null;
	cache.plan = null;
	storeForget(["week", "shopping"]);
}

/**
 * Loads a screen: render(data, fresh) runs at once with the kept copy (fresh = false), then
 * with the Sheet's answer if it differs. failed(error) runs only if there's nothing to show.
 */
function quick(action, extra, render, failed) {
	var key = storeKey(action, extra);
	var token = screenToken;
	var kept = storeEntry(key);
	var old = kept && kept.data;
	var shown = old ? JSON.stringify(old) : null;
	if (old) {
		try { render(old, false); } catch (e) { shown = null; }
	}
	return call(action, extra).then(function (data) {
		storePut(key, data);
		if (token !== screenToken) return;
		if (JSON.stringify(data) === shown) return;
		var y = window.scrollY;
		render(data, true);
		if (shown) window.scrollTo(0, y);
	}).catch(function (e) {
		if (token !== screenToken) return;
		// a phone that's set up wrong must say so, even with an old copy to show; anything else
		// (no signal, Google sending an error page) leaves the copy up, saying how old it is
		if (!shown || /SECRET|SETUP/.test(e.code || "")) failed(e);
		else staleNote(kept.at);
	});
}

/** A line at the top of the screen that stays: what's shown is a copy the Sheet hasn't confirmed. */
function staleNote(at) {
	var old = main.querySelector(".stale");
	if (old) old.remove();
	main.insertBefore(el("div", { class: "stale", role: "status" },
		el("b", null, "Couldn't check the Sheet. "), "This is the copy from " + (at ? whenText(at) : "an earlier visit") + "; it may be out of date."), main.firstChild);
}

/** 1700000000000 -> "Mon 9 Nov, 18:02" (or "today, 18:02") */
function whenText(ms) {
	var d = new Date(ms);
	var day = londonKey(d) === londonToday() ? "today" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
	return day + ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

/** Today in London as "YYYY-MM-DD", from the phone's own clock (not from a kept copy). */
function londonKey(d) {
	try {
		var parts = {};
		new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d)
			.forEach(function (p) { parts[p.type] = p.value; });
		if (parts.year && parts.month && parts.day) return parts.year + "-" + parts.month + "-" + parts.day;
	} catch (e) { /* an old browser: the phone's own time zone */ }
	return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function londonToday() { return londonKey(new Date()); }

/**
 * Which day is tonight, and which have gone, worked out here from each day's date: a kept copy
 * of the week says "today" as it was when it was fetched, which could be days ago.
 */
function freshDays(w) {
	if (!w || !w.days) return w;
	if (w.servedToday === undefined) {
		var t = w.days.filter(function (d) { return d.isToday; })[0];
		w.servedToday = t ? t.key : null; // the day the Sheet called today (tonight's photo is for that day)
	}
	var today = londonToday();
	w.days.forEach(function (d) { d.isToday = d.key === today; d.isPast = d.key < today; });
	return w;
}

/** Fetches a few likely next screens in the background, at most every 10 minutes. */
var lastPrefetch = 0;
function prefetch(w) {
	if (Date.now() - lastPrefetch < 10 * 60 * 1000 || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
	lastPrefetch = Date.now();
	var jobs = [["recipes", {}], ["shopping", { offset: shopOffset }]];
	(w.days || []).forEach(function (d) {
		if (d.key === londonToday() && d.dinner && d.dinner.recipeId) jobs.unshift(["recipe", { id: d.dinner.recipeId, day: d.key }]);
	});
	jobs.forEach(function (j) {
		call(j[0], j[1]).then(function (data) { storePut(storeKey(j[0], j[1]), data); }).catch(function () { /* try again later */ });
	});
}

/* photos kept in the Sheet ("sheet:<id>") are fetched once and kept on the phone: they never change */
var PHOTO_CACHE = "dinners-photos";
var photoMemory = {};
function sheetPhoto(pid) {
	if (photoMemory[pid]) return photoMemory[pid];
	var url = "photo/" + pid;
	var fromStore = typeof caches !== "undefined"
		? caches.open(PHOTO_CACHE).then(function (c) { return c.match(url).then(function (hit) { return hit ? hit.text() : null; }); }).catch(function () { return null; })
		: Promise.resolve(null);
	photoMemory[pid] = fromStore.then(function (text) {
		if (text) return text;
		return call("sheetPhoto", { pid: pid }).then(function (res) {
			if (!res.photo) return null;
			if (typeof caches !== "undefined") caches.open(PHOTO_CACHE).then(function (c) { return c.put(url, new Response(res.photo)); }).catch(function () { /* fine */ });
			return res.photo;
		});
	}).catch(function () { delete photoMemory[pid]; return null; });
	return photoMemory[pid];
}

/* ---------------- small helpers ---------------- */
var ICONS = {
	week: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
	recipes: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h8M8 13h6"/></svg>',
	shopping: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.4 11h11l2-8H6.2"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/></svg>',
	back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
	edit: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
	cog: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
	print: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
	camera: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
	open: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
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
/** A photo that hides itself if it can't load. "sheet:<id>" photos come from the phone's store. */
function photo(src, alt) {
	if (/^sheet:/.test(src || "")) {
		var img = el("img", { alt: alt || "", class: "loadingimg", onerror: function (e) { e.target.remove(); } });
		sheetPhoto(src.slice(6)).then(function (data) { if (data) { img.src = data; img.classList.remove("loadingimg"); } else img.remove(); });
		return img;
	}
	return el("img", { src: src, alt: alt || "", onerror: function (e) { e.target.remove(); } });
}
function icon(name) { return el("span", { html: ICONS[name], style: "display:inline-flex" }); }
function chips(r, withCarbs) {
	return el("div", { class: "chips" },
		r.marked ? el("span", { class: "chip marked" }, badgeText()) : null,
		r.minutes ? el("span", { class: "chip" }, r.minutes + " min") : null,
		(r.types || []).map(function (t) { return el("span", { class: "chip" }, TYPE_LABELS[t] || t); }),
		withCarbs && r.carbsPer100g !== null && r.carbsPer100g !== undefined ? el("span", { class: "chip carbs" }, r.carbsPer100g + "g carbs per 100g") : null);
}
/* ---------------- filters (Recipes list and Plan) ---------------- */
var TYPES = ["chicken", "beef", "pork", "fish", "soup", "vegetarian", "salad"];
var TYPE_LABELS = { chicken: "Chicken", beef: "Beef", pork: "Pork", fish: "Fish", soup: "Soup", vegetarian: "Vegetarian", salad: "Salad" };
var TIMES = [0, 20, 30, 45];
var NO_COOKING = ["Takeaway", "Out", "Leftovers"];

function newFilter() { return { types: [], maxMin: 0, marked: false, noPhoto: false }; }

function matchFilter(r, f) {
	if (f.types.length && !(r.types || []).some(function (t) { return f.types.indexOf(t) !== -1; })) return false;
	if (f.maxMin && !(r.minutes && r.minutes <= f.maxMin)) return false;
	if (f.marked && !r.marked) return false;
	if (f.noPhoto && r.hasPhoto) return false;
	return true;
}

function filterCount(f) { return f.types.length + (f.maxMin ? 1 : 0) + (f.noPhoto ? 1 : 0); }

/**
 * The filter bar: "Filters" (opens types and time), the badge-only toggle and, on the
 * Recipes list, "No photo". items: the recipes, to show only types that are in use.
 * extra: more controls for the first row (the sort). onChange runs after every tap.
 */
function filterBar(f, items, opts, onChange) {
	var open = filterCount(f) > 0 && opts.startOpen;
	var wrap = el("div", { class: "filters" });
	var draw = function () {
		wrap.textContent = "";
		var n = filterCount(f);
		var toggle = function (label, on, fn, cls) {
			return el("button", { type: "button", class: "toggle" + (cls ? " " + cls : ""), "aria-pressed": String(on), onclick: function () { fn(); draw(); onChange(); } }, label);
		};
		var row = el("div", { class: "frow" },
			el("button", { type: "button", class: "toggle fbtn", "aria-expanded": String(open), onclick: function () { open = !open; draw(); } },
				"Filters" + (n ? " (" + n + ")" : ""), el("span", { class: "caret", "aria-hidden": "true" }, open ? "\u25b4" : "\u25be")),
			toggle(badgeText(" only"), f.marked, function () { f.marked = !f.marked; }, "marked"),
			opts.extra || null);
		wrap.appendChild(row);
		if (!open) return;
		var used = TYPES.filter(function (t) { return items.some(function (r) { return (r.types || []).indexOf(t) !== -1; }); });
		var panel = el("div", { class: "fpanel" },
			el("div", { class: "flabel" }, "Type"),
			el("div", { class: "frow" }, used.length ? used.map(function (t) {
				var on = f.types.indexOf(t) !== -1;
				return toggle(TYPE_LABELS[t], on, function () { if (on) f.types.splice(f.types.indexOf(t), 1); else f.types.push(t); });
			}) : el("span", { class: "small muted" }, "No recipe has a Type yet: add it on the Recipes tab.")),
			el("div", { class: "flabel" }, "Time"),
			el("div", { class: "frow seg" }, TIMES.map(function (m) {
				return toggle(m ? "\u2264 " + m + " min" : "Any time", f.maxMin === m, function () { f.maxMin = m; });
			})),
			opts.noPhoto ? el("div", { class: "frow" }, toggle("No photo yet", f.noPhoto, function () { f.noPhoto = !f.noPhoto; })) : null,
			n ? el("button", { type: "button", class: "linkbtn", onclick: function () { f.types = []; f.maxMin = 0; f.noPhoto = false; draw(); onChange(); } }, "Clear filters") : null);
		wrap.appendChild(panel);
	};
	draw();
	return wrap;
}

/** A box for a dinner that isn't a recipe: the quick ones, or type anything. */
function otherDinner(quick, onPick) {
	var input = el("input", { class: "field", type: "text", maxlength: "60", placeholder: "Type anything, e.g. Burgers", "aria-label": "Something else", enterkeyhint: "done", autocomplete: "off" });
	var use = el("button", { type: "button", class: "btn primary usebtn" }, "Use");
	var go1 = function () { var t = input.value.replace(/\s+/g, " ").trim(); if (t) onPick(t, false); else input.focus(); };
	use.addEventListener("click", go1);
	input.addEventListener("keydown", function (e) { if (e.key === "Enter") go1(); });
	return el("div", { class: "stack", style: "gap:10px" },
		el("div", { class: "grid3" }, quick.map(function (n) { return el("button", { type: "button", onclick: function () { onPick(n, true); } }, n); })),
		el("div", { class: "typerow" }, input, use));
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
var cache = { week: null, plan: null };

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
	screenToken++;
	renderNav();
	main.classList.toggle("plain", false);
	main.style.opacity = ""; // a save dims the screen while it works
	document.body.classList.remove("shopping");
	var paper = document.getElementById("printsheet");
	if (paper) paper.remove();
	window.scrollTo(0, 0);
	var a = current.args;
	wideDrawn = wide.matches;
	if (wide.matches) renderSide();
	if (current.name === "recipe") return screenRecipe(a.id, a.day);
	if (current.name === "edit") return screenEdit(a.id, a.day);
	if (current.name === "swap") return screenSwap(a.day);
	if (current.name === "recipes") return screenRecipes();
	if (current.name === "shopping") return screenShopping();
	if (current.name === "plan") return screenPlan();
	if (current.name === "settings") return screenSettings();
	if (current.name === "setup") return screenSetupConfirm();
	if (!getSettings().url) return screenSettings(true);
	return screenWeek();
}
// Printing lays the page out at paper width, which can cross the laptop/phone line: don't redraw
// then, or the page being printed is swapped for a half-drawn one (a blank printout).
var printing = false;
window.addEventListener("beforeprint", function () { printing = true; });
window.addEventListener("afterprint", function () {
	printing = false;
	if (wide.matches !== wideDrawn) show();
});
var wideDrawn = wide.matches;
wide.addEventListener("change", function () {
	if (printing || window.matchMedia("print").matches || wide.matches === wideDrawn) return;
	show();
});

/* ---------------- This week ---------------- */
var PLAN_FRESH_MS = 5 * 60 * 1000;

/**
 * Next week's plan options. The Week screen asks for them in the background (the Sheet takes
 * a few seconds to work them out), so Plan usually opens at once. Kept for 5 minutes, and
 * dropped whenever a dinner changes.
 */
function loadPlan(prefetch) {
	if (cache.plan && Date.now() - cache.plan.at < PLAN_FRESH_MS) return cache.plan.promise;
	if (prefetch && !navigator.onLine) return null;
	var entry = { at: Date.now(), promise: call("planOptions", { exclude: [] }) };
	entry.promise.catch(function () { if (cache.plan === entry) cache.plan = null; });
	cache.plan = entry;
	return entry.promise;
}

function loadWeek(force) {
	if (!cache.week && !force) cache.week = storeGet(storeKey("week", { offset: 0 }));
	if (cache.week && !force) return Promise.resolve(freshDays(cache.week));
	return call("week", { offset: 0 }).then(function (w) { cache.week = freshDays(w); return w; });
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
		d.isToday && w.tonightPhoto && w.servedToday === d.key && !compact ? photo(w.tonightPhoto) : null,
		!d.isToday && !d.isPast ? el("span", { class: "hint" }, din && din.recipeId ? "" : "Choose") : null);
}

function weekList(w, compact) {
	return el("div", { class: "days" }, w.days.map(function (d) { return dayRow(d, w, compact); }),
		el("button", { type: "button", class: "next", onclick: function () { go("plan"); } },
			el("span", { class: "row", style: "width:100%" },
				el("span", { class: "stack", style: "gap:2px" },
					el("b", null, w.nextWeek.planned >= 7 ? "Next week is planned" : w.nextWeek.planned ? "Next week: " + w.nextWeek.planned + " of 7 nights planned" : "Next week isn't planned yet"),
					el("span", { class: "small muted" }, w.nextWeek.range)),
				el("span", { class: "planbtn" }, w.nextWeek.planned >= 7 ? "See it" : "Plan"))));
}

function screenWeek() {
	loading(main);
	var token = screenToken;
	quick("week", { offset: 0 }, function (w) {
		cache.week = freshDays(w);
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
	}, function (e) { showError(main, e, screenWeek); }).then(function () {
		// once the Sheet has answered: get next week's plan and the likely next screens ready
		if (token !== screenToken || !cache.week) return;
		var pre = loadPlan(true);
		if (pre) pre.catch(function () { /* Plan will ask again and show the error there */ });
		prefetch(cache.week);
	});
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
	quick("recipe", { id: id, day: dayKey || null }, function (r) {
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
		if (day) day.isToday = day.key === londonToday();
		// the calendar now has something else on that day (changed on another phone, or in Google Calendar)
		var moved = day && r.dayDinner !== undefined && !(r.dayDinner && r.dayDinner.recipeId === r.id);
		var dayLabel = day ? (day.isToday ? "Tonight" : day.label) : "";
		var whenText = moved ? "" : dayLabel;
		main.textContent = "";
		add(main, [
			!inWeek ? el("button", { type: "button", class: "back", onclick: back }, icon("back"), "Back") : null,
			whenText ? el("div", { class: "eyebrow" }, whenText) : null,
			moved ? el("div", { class: "notice", role: "alert" },
				el("b", null, r.dayDinner ? (day.isToday ? "Tonight's" : day.label + "'s") + " dinner is now " + r.dayDinner.title + "." : "Nothing is planned for " + (day.isToday ? "tonight" : day.label) + " now."),
				el("div", null, "This recipe isn't on that day any more."),
				r.dayDinner && r.dayDinner.recipeId ? el("button", { type: "button", class: "btn primary", onclick: function () { go("recipe", { id: r.dayDinner.recipeId, day: day.key }, true); } }, "Open " + r.dayDinner.title) : null) : null,
			(r.warnings || []).length ? el("div", { class: "notice", role: "alert" }, el("b", null, "Check the Sheet: "), r.warnings.join(" ")) : null,
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
				el("button", { type: "button", class: "btn", onclick: function () { window.print(); } }, icon("print"), "Print"),
				day && !moved && day.key >= londonToday() ? el("button", { type: "button", class: "btn primary", onclick: function () { go("swap", { day: day.key }); } }, icon("swap"), "Swap " + day.label + "'s dinner") : null)
		]);
	}, function (e) { showError(main, e, function () { screenRecipe(id, dayKey, inWeek); }); });
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
		var pic = r.photo ? photo(r.photo, "Current photo") : el("div", { class: "nophoto" }, "No photo yet");
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
				storeForget(["recipe:" + JSON.stringify({ id: r.id }).slice(0, -1), "recipes", "week"]);
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
				changed();
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
		var others = o.others.filter(function (x) { return !x.isPast; });
		main.textContent = "";
		add(main, [
			el("button", { type: "button", class: "back", onclick: back }, icon("back"), "Cancel"),
			el("h1", { style: "font-size:24px" }, "Swap " + o.day.label),
			el("div", { class: "muted" }, "Now: ", el("b", { style: "color:var(--text)" }, o.now ? o.now.title : "nothing planned")),
			// swapping with another night this week is the most likely change, so it comes first
			others.length ? el("section", { class: "stack" }, el("h2", null, "Swap with another day"),
				el("div", { class: "list" }, others.map(function (x) {
					return el("button", { type: "button", onclick: function () { done(call("swapDays", { dayA: dayKey, dayB: x.key }), "Swapped " + o.day.label + " and " + x.label); } },
						el("b", null, x.label), el("span", { class: x.title ? "" : "muted" }, x.title || "Nothing planned"));
				}))) : null,
			o.suggestions.length ? el("section", { class: "stack" }, el("h2", null, "Suggestions"),
				o.suggestions.map(function (r) { return pickCard(r, (r.minutes ? r.minutes + " min \u00b7 " : "") + r.why, put(r)); })) : null,
			el("section", { class: "stack" }, el("label", { for: "find", class: "lab", style: "font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)" }, "Or find a recipe"), search, results),
			el("section", { class: "stack" }, el("h2", null, "Something else"),
				otherDinner(o.noCooking || NO_COOKING, function (t, quick) {
					done(call("setDinner", { day: dayKey, choice: quick ? { noCooking: t } : { text: t } }), t + " on " + o.day.label);
				})),
			el("p", { class: "small muted", style: "margin:0" }, "Your choice goes straight into the Dinners calendar and onto the fridge.")
		]);
	}).catch(function (e) { showError(main, e, function () { screenSwap(dayKey); }); });
}

function pickCard(r, sub, onclick) {
	return el("button", { type: "button", class: "pick", onclick: onclick },
		r.photo ? photo(r.photo) : el("div", { class: "ph" }),
		el("div", { class: "stack", style: "gap:3px;flex:1;min-width:0" },
			el("div", { class: "t" }, r.title),
			el("div", { class: "small muted" }, r.marked ? el("b", { style: "color:var(--mark)" }, badgeText(" \u00b7 ")) : null, sub)));
}

/* ---------------- plan next week ---------------- */
var DRAFT_KEY = "dinners.plan.";
function loadDraft(weekStart) {
	try { return JSON.parse(localStorage.getItem(DRAFT_KEY + weekStart) || "null"); } catch (e) { return null; }
}
function saveDraft(weekStart, draft) {
	try {
		Object.keys(localStorage).forEach(function (k) { if (k.indexOf(DRAFT_KEY) === 0 && k !== DRAFT_KEY + weekStart) localStorage.removeItem(k); });
		if (draft) localStorage.setItem(DRAFT_KEY + weekStart, JSON.stringify(draft)); else localStorage.removeItem(DRAFT_KEY + weekStart);
	} catch (e) { /* private window: the plan just isn't kept */ }
}

var planFilter = newFilter(); // kept while the app is open

/** Weighted picks from the plan pool (same steps as drawShortlist_ in App.gs). */
function drawPool(pool, size, share, skip) {
	var items = pool.filter(function (x) { return !skip[x.id]; });
	var take = function (list, key, n) {
		var out = [], left = list.slice();
		while (out.length < n && left.length) {
			var total = left.reduce(function (t, x) { return t + x[key]; }, 0);
			var pick = Math.random() * total;
			var i = 0;
			while (i < left.length - 1 && pick >= left[i][key]) { pick -= left[i][key]; i++; }
			out.push(left.splice(i, 1)[0]);
		}
		return out;
	};
	var favs = take(items, "fw", Math.round(size * share / 100));
	var rest = items.filter(function (x) { return favs.indexOf(x) === -1; });
	var surprises = take(rest, "sw", size - favs.length);
	var card = function (kind) { return function (x) { var c = Object.assign({}, x, { kind: kind }); if (kind === "surprise") c.why = x.whySurprise; delete c.fw; delete c.sw; delete c.whySurprise; return c; }; };
	return favs.map(card("favourite")).concat(surprises.map(card("surprise")));
}

function screenPlan() {
	var ready = cache.plan && Date.now() - cache.plan.at < PLAN_FRESH_MS;
	loading(main);
	if (!ready) main.querySelector(".loading").textContent = "Finding suggestions…";
	loadPlan(false).then(function (o) {
		if (!o.pool) throw new Error("The Sheet's script needs updating: paste the new App.gs and deploy a new version.");
		var start = o.week.start;
		var draft = loadDraft(start) || {};
		var picks = draft.picks || {}; // day key -> { id, title, marked, minutes } or { text: "Burgers" }
		var f = planFilter;
		var pool = o.pool.map(function (x) { x.hasPhoto = Boolean(x.photo || x.sheetPhoto); return x; });
		var fits = function () { return pool.filter(function (x) { return matchFilter(x, f); }); };
		var shown = draft.shown && draft.shown.length ? draft.shown : drawPool(fits(), o.size, o.share, {});
		// a kept draft can be days old: drop suggestions that can't be suggested now (had since,
		// planned, or gone from the Sheet), refresh the rest, and top up from the pool
		var inPool = {};
		pool.forEach(function (x) { inPool[x.id] = x; });
		var pickedIds = {};
		Object.keys(picks).forEach(function (k) { if (picks[k].id) pickedIds[picks[k].id] = true; });
		var before = shown.length;
		shown = shown.filter(function (r) { return inPool[r.id] || pickedIds[r.id]; }).map(function (r) {
			var x = inPool[r.id];
			return x ? Object.assign({}, r, { title: x.title, minutes: x.minutes, marked: x.marked, types: x.types, photo: x.photo, sheetPhoto: x.sheetPhoto, hasPhoto: x.hasPhoto }) : r;
		});
		if (shown.length < before) {
			var skipShown = {};
			shown.forEach(function (r) { skipShown[r.id] = true; });
			shown = shown.concat(drawPool(fits(), before - shown.length, o.share, skipShown));
		}
		var photos = {}; // id -> data URL, for photos kept in the Sheet
		// nights that already have a dinner in the calendar can't be picked over
		o.days.forEach(function (d) { if (d.dinner) delete picks[d.key]; });
		var keep = function () { saveDraft(start, { picks: picks, shown: shown }); };

		var nights = el("div", { class: "list nights" });
		var cards = el("div", { class: "scards" });
		var count = el("span", { class: "small muted" });
		var saveBtn = el("button", { type: "button", class: "btn primary" }, "Save the week");
		var moreBtn = el("button", { type: "button", class: "btn" }, "Show more suggestions");

		var pickedDay = function (id) {
			for (var k in picks) if (picks[k].id === id) return k;
			return null;
		};
		var dayOf = function (key) { return o.days.filter(function (d) { return d.key === key; })[0]; };
		var draw = function () {
			var planned = 0;
			nights.textContent = "";
			o.days.forEach(function (d) {
				var p = picks[d.key];
				if (d.dinner || p) planned++;
				nights.appendChild(el("div", { class: "night" + (d.dinner ? " fixed" : p ? " picked" : " free") },
					el("b", { class: "nd" }, d.label),
					el("span", { class: "nt" }, d.dinner ? d.dinner.title : p ? p.title || p.text : "Pick from below"),
					d.dinner ? el("span", { class: "small muted" }, "in calendar")
						: p ? el("button", { type: "button", class: "x", "aria-label": "Remove from " + d.dayName, onclick: function () { delete picks[d.key]; keep(); draw(); } }, "×")
						: el("button", { type: "button", class: "otherbtn", "aria-label": "Something else on " + d.dayName, onclick: function () { other(d); } }, "Other\u2026")));
			});
			count.textContent = planned + " of 7 nights planned";
			var newPicks = Object.keys(picks).length;
			saveBtn.disabled = newPicks === 0;
			saveBtn.textContent = newPicks ? "Save the week (" + newPicks + " new)" : "Save the week";
			cards.textContent = "";
			var list = shown.filter(function (r) { return pickedDay(r.id) || matchFilter(r, f); });
			if (!list.length) cards.appendChild(el("div", { class: "small muted" }, filterCount(f) || f.marked ? "No recipes fit these filters." : "No suggestions: everything was had recently."));
			list.forEach(function (r) {
				var on = pickedDay(r.id);
				var img = r.photo || photos[r.id];
				cards.appendChild(el("button", { type: "button", class: "scard" + (on ? " on" : ""), onclick: function () { popup(r); } },
					img ? photo(img) : r.sheetPhoto ? el("span", { class: "noimg" }) : null,
					el("span", { class: "sc" },
						el("span", { class: "t" }, r.title),
						on ? el("span", { class: "small onday" }, "✓ On " + dayOf(on).dayName)
							: el("span", { class: "small muted" }, r.marked ? el("b", { style: "color:var(--mark)" }, badgeText(" · ")) : null, (r.minutes ? r.minutes + " min · " : "") + (r.kind === "favourite" ? "favourite" : "surprise")))));
			});
		};
		// photos kept in the Sheet arrive one by one
		var fetchPhotos = function () {
			shown.filter(function (r) { return r.sheetPhoto && !r.photo && !photos[r.id]; }).forEach(function (r) {
				call("photo", { id: r.id }).then(function (res) { if (res.photo) { photos[r.id] = res.photo; draw(); } }).catch(function () { /* no photo */ });
			});
		};

		var sheet = function (title, body) {
			var overlay;
			var close = function () { overlay.remove(); };
			overlay = el("div", { class: "overlay", onclick: function (e) { if (e.target === overlay) close(); } },
				el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
					el("div", { class: "row" }, el("h2", { style: "color:var(--text);font-size:20px;letter-spacing:0;text-transform:none" }, title),
						el("button", { type: "button", class: "x", "aria-label": "Close", onclick: close }, "×")),
					body(close)));
			document.body.appendChild(overlay);
			return overlay;
		};
		var other = function (d) {
			var ov = sheet(d.dayName + ": something else", function (close) {
				return otherDinner(NO_COOKING, function (t) { picks[d.key] = { text: t }; keep(); draw(); close(); toast(t + " on " + d.dayName); });
			});
			var inp = ov.querySelector("input");
			if (inp && !("ontouchstart" in window)) inp.focus();
		};

		var popup = function (r) {
			var free = o.days.filter(function (d) { return !d.dinner && !picks[d.key]; });
			var on = pickedDay(r.id);
			var body = el("div", { class: "stack" }, el("div", { class: "loading" }, "Loading…"));
			var close = function () { overlay.remove(); };
			var overlay = el("div", { class: "overlay", onclick: function (e) { if (e.target === overlay) close(); } },
				el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": r.title },
					el("div", { class: "row" }, el("h2", { style: "color:var(--text);font-size:20px;letter-spacing:0;text-transform:none" }, r.title),
						el("button", { type: "button", class: "x", "aria-label": "Close", onclick: close }, "×")),
					body,
					el("div", { class: "stack", style: "gap:8px" },
						el("h2", null, on ? "On " + dayOf(on).dayName : "Put it on"),
						on ? el("button", { type: "button", class: "btn", onclick: function () { delete picks[on]; keep(); draw(); close(); } }, "Take it off " + dayOf(on).dayName)
							: free.length ? el("div", { class: "daygrid" }, free.map(function (d) {
								return el("button", { type: "button", onclick: function () { picks[d.key] = { id: r.id, title: r.title, marked: r.marked, minutes: r.minutes }; keep(); draw(); close(); toast(r.title + " on " + d.dayName); } }, d.label);
							})) : el("div", { class: "small muted" }, "Every night is planned. Remove one with × to make room.")),
					el("button", { type: "button", class: "btn", onclick: function () { close(); go("recipe", { id: r.id }); } }, icon("open"), "Open the full recipe")));
			document.body.appendChild(overlay);
			call("recipe", { id: r.id }).then(function (full) {
				body.textContent = "";
				add(body, [
					el("div", { class: "rhead" },
						el("div", { class: "words" }, chips(full, true), el("div", { class: "small muted" }, full.lastHad)),
						full.photo ? photo(full.photo) : null),
					full.notes ? el("div", { class: "notes small" }, full.notes) : null,
					el("div", { class: "small" }, el("b", null, "Ingredients for " + full.household + ": "),
						full.ingredients.map(function (i) { var x = FridgeScale.scaleIngredient(i, full.servings, full.household); return (x.amount ? x.amount + " " : "") + x.item; }).join(" · "))
				]);
			}).catch(function (e) { body.textContent = e.message; });
		};

		var redraw = function (skipSeen) {
			var kept = shown.filter(function (r) { return pickedDay(r.id); });
			var skip = {};
			kept.forEach(function (r) { skip[r.id] = true; });
			if (skipSeen) shown.forEach(function (r) { skip[r.id] = true; });
			var fresh = drawPool(fits(), o.size, o.share, skip);
			if (skipSeen && !fresh.length) {
				toast("That's every recipe that fits. Showing the first ones again.");
				fresh = drawPool(fits(), o.size, o.share, kept.reduce(function (m, r) { m[r.id] = true; return m; }, {}));
			}
			shown = kept.concat(fresh);
			keep(); draw(); fetchPhotos();
		};
		moreBtn.addEventListener("click", function () { redraw(true); window.scrollTo(0, cards.offsetTop - 80); });
		var bar = filterBar(f, pool, { startOpen: true }, function () { redraw(false); });
		saveBtn.addEventListener("click", function () {
			var list = Object.keys(picks).map(function (k) { return picks[k].id ? { day: k, recipeId: picks[k].id } : { day: k, text: picks[k].text }; });
			saveBtn.disabled = true;
			saveBtn.textContent = "Saving…";
			call("savePlan", { picks: list }).then(function (res) {
				saveDraft(start, null);
				changed();
				var gone = res.skipped.filter(function (x) { return x.gone; }).length;
				var taken = res.skipped.length - gone;
				toast(res.saved.length + " dinner" + (res.saved.length === 1 ? "" : "s") + " saved" +
					(taken ? ". " + taken + " night" + (taken === 1 ? " was" : "s were") + " already taken" : "") +
					(gone ? ". " + gone + " recipe" + (gone === 1 ? " isn't" : "s aren't") + " in the Sheet any more, so " + (gone === 1 ? "its night was" : "their nights were") + " left empty" : ""));
				go("plan", {}, true);
			}).catch(function (e) { toast(e.message); draw(); });
		});

		draw();
		fetchPhotos();
		main.textContent = "";
		add(main, [
			el("button", { type: "button", class: "back", onclick: back }, icon("back"), "Back"),
			el("div", { class: "row", style: "align-items:baseline" }, el("h1", { style: "font-size:24px" }, "Plan " + o.week.range), null),
			el("section", { class: "stack" }, el("div", { class: "row" }, el("h2", null, "The week"), count), nights),
			el("section", { class: "stack" },
				el("div", { class: "row" }, el("h2", null, "Suggestions"), el("span", { class: "small muted" }, "Tap one to see it")),
				bar,
				cards, moreBtn),
			el("div", { class: "stack savebar" }, saveBtn,
				el("div", { class: "small muted", style: "text-align:center" }, "Empty nights stay empty. Saving puts the dinners in the calendar, and on the fridge."))
		]);
	}).catch(function (e) { showError(main, e, screenPlan); });
}

/* ---------------- all recipes ---------------- */
var listState = { filter: newFilter(), sort: "az", q: "" }; // kept while the app is open

function shortKey(k) {
	var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || "");
	return m ? Number(m[3]) + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1] : "";
}

function screenRecipes() {
	loading(main);
	quick("recipes", {}, function (res) {
		var f = listState.filter;
		var list = el("div", { class: "list" });
		var shown = el("span", { class: "small muted" });
		var search = el("input", { id: "rsearch", class: "field", type: "search", placeholder: "Search recipes", autocomplete: "off", value: listState.q });
		var sort = el("select", { class: "sortsel", "aria-label": "Sort" },
			el("option", { value: "az" }, "A\u2013Z"),
			el("option", { value: "most", disabled: res.counted ? null : "" }, "Most often"),
			el("option", { value: "least", disabled: res.counted ? null : "" }, "Least often"));
		if (!res.counted && listState.sort !== "az") listState.sort = "az";
		sort.value = listState.sort;
		var draw = function () {
			var q = search.value.trim().toLowerCase();
			listState.q = search.value;
			var rows = res.recipes.filter(function (r) { return matchFilter(r, f) && (!q || r.title.toLowerCase().indexOf(q) !== -1); });
			var bySort = listState.sort;
			if (bySort !== "az") rows = rows.slice().sort(function (a, b) {
				var d = bySort === "most" ? b.count - a.count : a.count - b.count;
				return d || (bySort === "least" ? String(a.last || "").localeCompare(String(b.last || "")) : 0) || a.title.localeCompare(b.title);
			});
			shown.textContent = rows.length === res.recipes.length ? res.recipes.length + " in the Sheet" : rows.length + " of " + res.recipes.length;
			list.textContent = "";
			if (!rows.length) list.appendChild(el("div", { class: "small muted", style: "padding:14px 0" }, "No recipes match."));
			rows.forEach(function (r) {
				var freq = bySort === "az" ? null : r.count ? r.count + "\u00d7 in 6 months \u00b7 last " + shortKey(r.last) : "Not had in 6 months";
				list.appendChild(el("button", { type: "button", onclick: function () { go("recipe", { id: r.id }); } },
					el("span", { class: "rt" },
						el("span", { style: "font-weight:700" }, r.title),
						freq ? el("span", { class: "small muted" }, freq) : null),
					el("span", { class: "small muted meta" },
						r.hasPhoto ? el("span", { class: "cam", title: "Has a photo", "aria-label": "Has a photo", role: "img", html: ICONS.camera }) : null,
						r.marked ? el("b", { style: "color:var(--mark)" }, badgeText("")) : null,
						r.minutes ? el("span", null, r.minutes + " min") : null)));
			});
		};
		search.addEventListener("input", draw);
		sort.addEventListener("change", function () { listState.sort = sort.value; draw(); });
		var bar = filterBar(f, res.recipes, { noPhoto: true, extra: sort, startOpen: true }, draw);
		draw();
		main.textContent = "";
		add(main, [
			el("div", { class: "row", style: "align-items:baseline" }, el("h1", null, "Recipes"), shown),
			el("label", { for: "rsearch", class: "hidden" }, "Search recipes"),
			search,
			bar,
			list
		]);
	}, function (e) { showError(main, e, screenRecipes); });
}

/* ---------------- shopping ---------------- */
var shopOffset = 1; // which week the list is for: 1 = next week, 0 = this week
var shopView = "all"; // "added": just the things added by hand, for a quick trip mid-week
try { if (localStorage.getItem("dinners.shopView") === "added") shopView = "added"; } catch (e) { /* default */ }

function screenShopping() {
	loading(main);
	document.body.classList.add("shopping");
	var touched = false; // once you've ticked or added something, a late answer from the Sheet doesn't redraw over it
	var storeAt = storeKey("shopping", { offset: shopOffset });
	var mine = null; // the list as changed on this phone
	var syncSheet = null; // saves the list to the Sheet if it differs from what the Sheet has
	quick("shopping", { offset: shopOffset }, function (s, fresh) {
		if (current.name !== "shopping" || (fresh && touched)) return;
		// what the Sheet had (s.saved) plus the changes made here since (s.pending), in order
		var pending = (s.pending || []).slice();
		var base = s.saved.sig; // the Sheet's list these changes were made on
		var stateOf = function (saved) { return { unticked: saved.unticked.slice(), ticked: (saved.ticked || []).slice(), added: saved.added.slice() }; };
		var state = stateOf(s.saved);
		pending.forEach(function (op) { applyShopChange(state, op); });
		var known = {};
		(s.known || []).forEach(function (k) { known[FridgeShop.itemKey(k[0])] = k[1]; });
		var sectionNames = s.sections.map(function (x) { return x.name; });
		var list = null;
		var groupsEl = el("div", { class: "stack", style: "gap:16px" });
		var oftenEl = el("div", { class: "frow" });
		var printBtn = el("button", { type: "button", class: "btn primary", onclick: function () { window.print(); } });
		var printBar = el("div", { class: "stack savebar" }, printBtn);
		var viewRow = el("div", { class: "frow" });
		var info = el("div", { class: "card small" });
		var setView = function (v) {
			shopView = v;
			try { localStorage.setItem("dinners.shopView", v); } catch (e) { /* just for now */ }
			draw();
		};
		var saveTimer = null;

		var build = function () {
			list = FridgeShop.buildList({ dinners: s.dinners, recipes: s.recipes, household: s.household, regulars: s.regulars,
				added: state.added, unticked: state.unticked, ticked: state.ticked, sections: s.sections, order: s.order });
		};
		var rowsToSave = function () {
			var rows = [];
			list.groups.forEach(function (g) { g.items.forEach(function (x) { rows.push({ buy: x.ticked, item: x.name, qty: x.qty, section: x.section, from: x.from }); }); });
			return rows;
		};
		var sigOf = function (rows) { return rows.map(function (x) { return [x.item, x.qty, x.buy ? 1 : 0].join("|"); }).join("\n"); };
		// keep this phone's copy up to date (with the changes not saved yet), so coming back shows
		// the list as you left it, even if the Sheet couldn't be reached
		var keepCopy = function () {
			s.pending = pending.slice();
			s.saved.sig = base;
			storePut(storeAt, s);
			mine = s;
		};
		var sending = false, again = false, tries = 0;
		var send = function () {
			if (sending) { again = true; return; }
			sending = true;
			var rows = rowsToSave();
			var sent = pending.length;
			call("shopSave", { week: s.week.start, rows: rows, base: base }).then(function (res) {
				sending = false;
				if (res && res.conflict) {
					// another phone saved first: start from what the Sheet has now, put this phone's
					// changes on top, and save that (so neither phone's changes are lost)
					if (++tries > 3) { toast("The list wasn't saved: another phone keeps changing it. Open the list again."); return; }
					s.saved = res.saved;
					base = res.saved.sig;
					state = stateOf(res.saved);
					pending.forEach(function (op) { applyShopChange(state, op); });
					draw(); keepCopy(); send();
					return;
				}
				tries = 0;
				pending = pending.slice(sent);
				base = res && typeof res.sig === "string" ? res.sig : sigOf(rows);
				s.saved = { any: true, unticked: state.unticked.slice(), ticked: state.ticked.slice(), added: state.added.slice(), sig: base };
				keepCopy();
				if (again) { again = false; send(); }
			}).catch(function (e) {
				sending = false;
				toast("The list wasn't saved: " + e.message);
			});
		};
		var save = function (now) {
			touched = touched || !now;
			keepCopy();
			clearTimeout(saveTimer);
			saveTimer = setTimeout(send, now ? 0 : 900);
		};
		var change = function (op) {
			pending.push(op);
			applyShopChange(state, op);
			draw(); save();
		};
		var onList = function (key) { return list.groups.some(function (g) { return g.items.some(function (x) { return x.key === key; }); }); };
		var toggle = function (x) { change({ op: x.ticked ? "untick" : "tick", item: x.name }); };
		var removeAdded = function (x) {
			change({ op: "remove", item: x.name });
			toast(x.name + " taken off");
		};
		var addItem = function (item, section) {
			change({ op: "add", item: item, section: section });
			toast(item + " added to " + section);
		};

		var draw = function () {
			build();
			var addedOnly = shopView === "added";
			var nAdded = 0;
			list.groups.forEach(function (g) { g.items.forEach(function (x) { if (x.added) nAdded++; }); });
			viewRow.textContent = "";
			add(viewRow, [
				el("button", { type: "button", class: "toggle", "aria-pressed": String(!addedOnly), onclick: function () { setView("all"); } }, "Everything"),
				el("button", { type: "button", class: "toggle", "aria-pressed": String(addedOnly), onclick: function () { setView("added"); } }, "Added by hand (" + nAdded + ")")
			]);
			info.textContent = "";
			info.style.display = addedOnly ? "none" : "";
			if (!addedOnly) add(info, ["Everything for " + s.week.range + " is ticked to buy. ", el("b", null, "Untick what you already have."),
				s.dinners.length ? el("div", { class: "muted", style: "margin-top:4px" }, "From " + s.dinners.length + " dinner" + (s.dinners.length === 1 ? "" : "s") + " with a recipe, for " + s.household + ".") : null]);
			printBar.style.display = addedOnly ? "none" : "";
			groupsEl.textContent = "";
			list.groups.forEach(function (g) {
				var items = addedOnly ? g.items.filter(function (x) { return x.added; }) : g.items;
				if (!items.length) return;
				groupsEl.appendChild(el("section", { class: "stack", style: "gap:6px" },
					el("h2", null, g.name),
					el("div", { class: "shopcard" }, items.map(function (x) {
						return el("div", { class: "srow" + (x.ticked ? "" : " off") },
							el("button", { type: "button", class: "stoggle", "aria-pressed": String(x.ticked), onclick: function () { toggle(x); } },
								el("span", { class: "sbox", html: x.ticked ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>' : "" }),
								el("span", { class: "stext" }, el("span", { class: "sname" }, x.label), el("span", { class: "sfrom" }, (x.check ? "Check the cupboard \u00b7 " : "") + x.from))),
							x.source === "added" ? el("button", { type: "button", class: "x", "aria-label": "Take " + x.name + " off the list", onclick: function () { removeAdded(x); } }, "×") : null);
					}))));
			});
			if (addedOnly && !nAdded) {
				groupsEl.appendChild(el("div", { class: "card stack" },
					el("b", null, "Nothing added by hand yet."),
					el("span", { class: "muted" }, "Add things below as you think of them, then come back here in the shop.")));
			} else if (!list.groups.some(function (g) { return g.items.length; })) {
				groupsEl.appendChild(el("div", { class: "card stack" },
					el("b", null, "Nothing on the list yet."),
					el("span", { class: "muted" }, s.dinners.length ? "" : "No dinners with a recipe are planned for " + s.week.range + ".")));
			}
			printBtn.textContent = "";
			add(printBtn, [icon("print"), "Print " + list.count + " item" + (list.count === 1 ? "" : "s")]);
			printBtn.disabled = list.count === 0;
			// Often bought: not already on the list
			oftenEl.textContent = "";
			(s.often || []).filter(function (o) { return !onList(FridgeShop.itemKey(o.item)); }).slice(0, 8).forEach(function (o) {
				oftenEl.appendChild(el("button", { type: "button", class: "toggle", onclick: function () { addItem(o.item, o.section || known[FridgeShop.itemKey(o.item)] || FridgeShop.OTHER); } }, "+ " + o.item));
			});
			drawPaper();
		};

		// the printed page (only shown when printing)
		var paperEl = el("div", { id: "printsheet" });
		var drawPaper = function () {
			var p = FridgeShop.paper(list);
			paperEl.textContent = "";
			add(paperEl, [
				el("div", { class: "phead" }, el("b", null, "Shopping · " + s.today), el("span", null, "for " + s.week.range)),
				el("div", { class: "pcols", style: "grid-template-columns:repeat(" + Math.max(1, p.columns.length) + ",minmax(0,1fr))" }, p.columns.map(function (c) {
					var fill = el("div", { class: "pfill" });
					for (var i = 0; i < 40; i++) fill.appendChild(el("div", { class: "pline" }, ""));
					return el("div", { class: "pcol" }, el("div", { class: "ptitle" }, c.name), c.lines.map(function (l) {
						return el("div", { class: "pline" + (l.text ? " filled" : "") + (l.gap ? " gap" : "") }, l.text);
					}), fill);
				})),
				p.blocks.map(function (b) {
					return el("div", { class: "pblock" }, el("div", { class: "ptitle left" }, b.name),
						el("div", { class: "pgrid" }, b.lines.map(function (l) { return el("div", { class: "pline" + (l.text ? " filled" : "") }, l.text); })));
				})
			]);
		};
		var old = document.getElementById("printsheet");
		if (old) old.remove();
		document.body.appendChild(paperEl);

		// adding something
		var input = el("input", { id: "additem", class: "field", type: "text", maxlength: "80", placeholder: "e.g. birthday candles", autocomplete: "off", enterkeyhint: "done" });
		var chosen = null;
		var secRow = el("div", { class: "frow" });
		var drawSections = function () {
			secRow.textContent = "";
			sectionNames.forEach(function (n) {
				secRow.appendChild(el("button", { type: "button", class: "toggle sec", "aria-pressed": String(chosen === n), onclick: function () { chosen = n; drawSections(); } }, n));
			});
		};
		input.addEventListener("input", function () {
			touched = true;
			var k = known[FridgeShop.itemKey(input.value)];
			if (k && sectionNames.indexOf(k) !== -1) { chosen = k; drawSections(); }
		});
		var addNow = function () {
			var t = input.value.replace(/\s+/g, " ").trim();
			if (!t) { input.focus(); return; }
			if (!chosen) { toast("Which section? Tap one below."); return; }
			addItem(t.charAt(0).toUpperCase() + t.slice(1), chosen);
			input.value = "";
			chosen = null;
			drawSections();
		};
		input.addEventListener("keydown", function (e) { if (e.key === "Enter") addNow(); });
		drawSections();

		// "This week · Thu 12 Nov" (its last day, the next big shop) and "Next week · Fri 13 Nov" (its first day)
		var dayLabel = function (key, plus) {
			var p = key.split("-").map(Number);
			var d = new Date(p[0], p[1] - 1, p[2] + (plus || 0));
			return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + d.getDate() + " " +
				["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
		};
		var weekBtn = function (n) {
			var w = s.weeks[n];
			return el("button", { type: "button", class: "toggle", "aria-pressed": String(s.offset === n), onclick: function () { if (s.offset !== n) { shopOffset = n; screenToken++; screenShopping(); } } },
				n ? "Next week \u00b7 " + dayLabel(w.start) : "This week \u00b7 " + dayLabel(w.start, 6));
		};

		draw();
		main.textContent = "";
		add(main, [
			el("div", { class: "row", style: "align-items:baseline" }, el("h1", null, "Shopping"), el("span", { class: "small muted" }, s.today)),
			el("div", { class: "frow" }, weekBtn(0), weekBtn(1)),
			viewRow,
			info,
			groupsEl,
			el("section", { class: "stack", style: "gap:8px" },
				el("label", { for: "additem", class: "lab", style: "font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700" }, "Add something"),
				el("div", { class: "typerow" }, input, el("button", { type: "button", class: "btn primary usebtn", onclick: addNow }, "Add")),
				el("div", { class: "small muted" }, "Section:"), secRow,
				s.often && s.often.length ? el("div", { class: "small muted" }, "Often bought:") : null, oftenEl),
			printBar
		]);
		// the Sheet's Shopping list tab follows the list, if it has changed (new dinners, new regulars)
		syncSheet = function () { if (pending.length || sigOf(rowsToSave()) !== base) save(true); };
	}, function (e) { showError(main, e, screenShopping); }).then(function () {
		if (touched && mine) storePut(storeAt, mine); // the Sheet's answer was from before your changes
		else if (syncSheet && current.name === "shopping") syncSheet();
	});
}

/** One change to the shopping list, on its state: tick, untick, add or remove (an added thing). */
function applyShopChange(state, op) {
	var key = FridgeShop.itemKey(op.item);
	var other = function (n) { return FridgeShop.itemKey(n) !== key; };
	if (op.op === "tick" || op.op === "untick") {
		state.unticked = state.unticked.filter(other);
		state.ticked = state.ticked.filter(other);
		(op.op === "untick" ? state.unticked : state.ticked).push(op.item);
	} else if (op.op === "add") {
		state.unticked = state.unticked.filter(other);
		if (state.ticked.every(other)) state.ticked.push(op.item);
		if (!state.added.some(function (a) { return FridgeShop.itemKey(a.item) === key; })) state.added.push({ item: op.item, qty: "", section: op.section });
	} else if (op.op === "remove") {
		state.added = state.added.filter(function (a) { return FridgeShop.itemKey(a.item) !== key; });
	}
	return state;
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
			changed();
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

/** An Apps Script web app's address (or the test server's): nothing else gets this phone's secret. */
var WEB_APP_URL = /^(?:https:\/\/script\.google\.com\/(?:a\/macros\/[A-Za-z0-9.-]+|macros)\/s\/[A-Za-z0-9_-]{20,}\/exec|http:\/\/localhost:\d+\/exec)$/;
var pendingSetup = null; // a setup link for a different Sheet, waiting for "Use the new link"

/**
 * A setup link: #setup=<base64 of {url, secret}>, then removed from the address.
 * Returns "saved", "same" (already set up like that), "ask" (this phone is set up for another
 * Sheet: the person chooses), "bad" (not a setup link this app can use) or false (no link).
 */
function takeSetupLink() {
	var m = /[#&]setup=([A-Za-z0-9_-]+)/.exec(location.hash);
	if (!m) return false;
	var result = "bad";
	try {
		var b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
		while (b64.length % 4) b64 += "=";
		var v = JSON.parse(atob(b64));
		if (v && typeof v.url === "string" && WEB_APP_URL.test(v.url) && typeof v.secret === "string" && v.secret) {
			var now = getSettings();
			if (now.url === v.url && now.secret === v.secret) result = "same";
			else if (now.url && now.secret) { pendingSetup = { url: v.url, secret: v.secret }; result = "ask"; }
			else {
				saveSettings({ url: v.url, secret: v.secret });
				setTimeout(function () { toast("This phone is set up. Add it to your home screen."); }, 300);
				result = "saved";
			}
		}
	} catch (e) { /* not a valid link */ }
	if (result === "bad") setTimeout(function () { toast("That setup link isn't right. Make a new one in the Sheet: Fridge > Phone app setup link."); }, 300);
	try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ }
	return result;
}

/** The last few letters of a web app's address, to tell two apart. */
function shortUrl(url) {
	var m = /\/s\/([A-Za-z0-9_-]+)\/exec/.exec(url || "");
	return m ? "\u2026" + m[1].slice(-6) : url;
}

function screenSetupConfirm() {
	var v = pendingSetup;
	if (!v) return go("week", {}, true);
	var now = getSettings();
	main.textContent = "";
	add(main, [
		el("h1", null, "Use this setup link?"),
		el("p", null, "This phone is already set up for a Sheet (web app ", el("b", null, shortUrl(now.url)), "). The link you opened is for ",
			now.url === v.url ? "the same web app with a new secret." : el("span", null, "a different one (", el("b", null, shortUrl(v.url)), ")."),
			" Only use it if it came from you, from Fridge > Phone app setup link in the Sheet."),
		el("div", { class: "stack" },
			el("button", { type: "button", class: "btn primary", onclick: function () {
				saveSettings({ url: v.url, secret: v.secret });
				pendingSetup = null;
				storeForget(); changed();
				toast("This phone is set up with the new link.");
				go("week", {}, true);
			} }, "Use the new link"),
			el("button", { type: "button", class: "btn", onclick: function () { pendingSetup = null; go("week", {}, true); } }, "Keep the current setup"))
	]);
}

/* ---------------- start ---------------- */
function parseHash(hash) {
	var m = /^#?([a-z]+)(?:\?(.*))?$/.exec(hash || "");
	var args = {};
	try {
		if (m && m[2]) m[2].split("&").forEach(function (p) { var kv = p.split("="); args[kv[0]] = decodeURIComponent(kv[1] || ""); });
	} catch (e) {
		return { name: "week", args: {} }; // a damaged link (cut short, say): start at the week
	}
	return { name: m ? m[1] : "week", args: args };
}
// a setup link opened while the app is already open in this tab
window.addEventListener("hashchange", function () {
	if (!/[#&]setup=/.test(location.hash)) return;
	var got = takeSetupLink();
	if (got === "saved") { storeForget(); changed(); go("week", {}, true); }
	else if (got === "ask") go("setup", {}, true);
});
var first = takeSetupLink() === "ask" ? { name: "setup", args: {} } : parseHash(location.hash);
go(first.name, first.args, true);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(function () { /* fine without */ });
