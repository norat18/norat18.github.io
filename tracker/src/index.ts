import { env } from "cloudflare:workers";
import dashboardHtml from "./dashboard.html?raw";

// Sites allowed to send events.
const ALLOWED_ORIGINS = ["https://norat18.github.io", "http://localhost:8765"];
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse/i;

export default {
	async fetch(request) {
		const url = new URL(request.url);

		if (url.pathname === "/e") {
			if (request.method === "OPTIONS") return new Response(null, { headers: cors(request) });
			if (request.method === "POST") return collect(request);
		}
		if (url.pathname === "/api/data" && request.method === "GET") return data(request, url);
		if (url.pathname === "/" && request.method === "GET") {
			return new Response(dashboardHtml, {
				headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" },
			});
		}
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler;

function cors(request: Request): HeadersInit {
	const origin = request.headers.get("origin") ?? "";
	return ALLOWED_ORIGINS.includes(origin)
		? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" }
		: {};
}

const clip = (v: unknown, n = 300) => (typeof v === "string" && v ? v.slice(0, n) : null);

async function collect(request: Request) {
	const headers = cors(request);
	const origin = request.headers.get("origin") ?? "";
	const ua = request.headers.get("user-agent") ?? "";
	if (!ALLOWED_ORIGINS.includes(origin) || BOT_UA.test(ua)) return new Response(null, { status: 204, headers });

	let body: Record<string, unknown>;
	try {
		body = JSON.parse(await request.text());
	} catch {
		return new Response("Bad request", { status: 400, headers });
	}
	const type = body.type === "click" ? "click" : body.type === "view" ? "view" : null;
	if (!type) return new Response("Bad request", { status: 400, headers });

	const cf = (request.cf ?? {}) as Record<string, unknown>;
	const { browser, os, device } = parseUA(ua);
	await env.DB.prepare(
		`INSERT INTO events (type, visitor, session, path, source, referrer, label, url, country, region, city, org, browser, os, device)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			type, clip(body.visitor, 64), clip(body.session, 64), clip(body.path), clip(body.source, 100),
			clip(body.referrer), clip(body.label, 100), clip(body.url),
			clip(cf.country), clip(cf.region), clip(cf.city), clip(cf.asOrganization), browser, os, device,
		)
		.run();
	return new Response(null, { status: 204, headers });
}

function parseUA(ua: string) {
	const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
		: /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other";
	const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS"
		: /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "Other";
	const device = /iPad|Tablet/.test(ua) ? "Tablet" : /Mobi|iPhone|Android/.test(ua) ? "Mobile" : "Desktop";
	return { browser, os, device };
}

// Constant-time comparison so the key can't be guessed by timing.
function sameKey(a: string, b: string) {
	const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
	if (x.length !== y.length) return false;
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
	return diff === 0;
}

async function data(request: Request, url: URL) {
	const key = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
	if (!env.DASHBOARD_KEY || !sameKey(key, env.DASHBOARD_KEY)) return Response.json({ error: "unauthorized" }, { status: 401 });

	const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 365);
	const since = new Date(Date.now() - days * 864e5).toISOString();

	const [visits, links, totals] = await env.DB.batch([
		env.DB.prepare(
			`SELECT session, MAX(visitor) AS visitor, MIN(ts) AS started, MAX(ts) AS last,
			        MAX(source) AS source, MAX(referrer) AS referrer, MAX(country) AS country, MAX(region) AS region,
			        MAX(city) AS city, MAX(org) AS org, MAX(browser) AS browser, MAX(os) AS os, MAX(device) AS device,
			        SUM(type = 'view') AS views,
			        json_group_array(CASE WHEN type = 'click' THEN label END) AS clicks
			 FROM events WHERE ts >= ? GROUP BY session ORDER BY started DESC LIMIT 500`,
		).bind(since),
		env.DB.prepare(
			`SELECT label, MAX(url) AS url, COUNT(*) AS clicks, COUNT(DISTINCT visitor) AS people
			 FROM events WHERE type = 'click' AND ts >= ? GROUP BY label ORDER BY clicks DESC`,
		).bind(since),
		env.DB.prepare(
			`SELECT COUNT(DISTINCT session) AS visits, COUNT(DISTINCT visitor) AS people, SUM(type = 'click') AS clicks
			 FROM events WHERE ts >= ?`,
		).bind(since),
	]);

	// How many visits each browser has made in total, to spot people who come back.
	const visitCounts = new Map(
		(await env.DB.prepare(`SELECT visitor, COUNT(DISTINCT session) AS n FROM events GROUP BY visitor`).all()).results.map(
			(r) => [r.visitor, r.n as number],
		),
	);

	return Response.json({
		days,
		totals: totals.results[0],
		links: links.results,
		visits: (visits.results as Record<string, unknown>[]).map((v) => ({
			...v,
			clicks: (JSON.parse(v.clicks as string) as (string | null)[]).filter(Boolean),
			visitorVisits: visitCounts.get(v.visitor) ?? 1,
		})),
	});
}
