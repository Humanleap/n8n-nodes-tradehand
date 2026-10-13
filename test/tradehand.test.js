// Runs every operation once against production tradehand.com (about 1 request each).
// Build first: `pnpm test` does both.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Tradehand } = require('../dist/nodes/Tradehand/Tradehand.node.js');

const node = new Tradehand();

function fake(params) {
	return {
		getNode: () => ({ name: 'Tradehand', type: 'tradehand', typeVersion: 1, parameters: {} }),
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name) => params[name],
		continueOnFail: () => false,
		helpers: {
			// Mirrors n8n: non-2xx throws unless ignoreHttpStatusErrors; returnFullResponse wraps the body.
			httpRequest: async ({ url, method, headers, body, ignoreHttpStatusErrors, returnFullResponse }) => {
				const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
				if (!res.ok && !ignoreHttpStatusErrors) throw new Error(`HTTP ${res.status}`);
				const parsed = await res.json().catch(() => undefined);
				return returnFullResponse ? { statusCode: res.status, body: parsed } : parsed;
			},
		},
	};
}

const run = async (params) => (await node.execute.call(fake(params)))[0].map((r) => r.json);

const search = { resource: 'trader', operation: 'search', trade: 'electrician', searchBy: 'postcode', postcode: 'SO23 9LS', maxResults: 3 };

test('trade options load', async () => {
	const options = await node.methods.loadOptions.getTrades.call(fake({}));
	assert.ok(options.length > 20 && options.some((o) => o.value === 'electrician'));
});

test('trade get many', async () => {
	const trades = await run({ resource: 'trade', operation: 'getAll', query: 'elec', returnAll: false, limit: 5 });
	assert.ok(trades.some((t) => t.value === 'electrician'));
});

let listing;
test('trader search', async () => {
	const rows = await run(search);
	assert.ok(rows.length >= 1 && rows.length <= 3);
	listing = rows[0];
	assert.ok(listing.publicReference && listing.name);
});

test('trader get', async () => {
	const [trader] = await run({ resource: 'trader', operation: 'get', publicReference: listing.publicReference });
	assert.equal(trader.publicReference, listing.publicReference);
});

test('trader get services', async () => {
	const [out] = await run({ resource: 'trader', operation: 'getServices', publicReference: listing.publicReference });
	assert.equal(out.publicReference, listing.publicReference);
	assert.ok(Array.isArray(out.services));
});

test('page get markdown', async () => {
	const [page] = await run({ resource: 'page', operation: 'getMarkdown', path: '/pricing' });
	assert.equal(page.path, '/pricing');
	assert.ok(page.markdown.length > 100);
});

test('invalid location throws the server sentence', async () => {
	await assert.rejects(run({ ...search, searchBy: 'location', location: 'SO23' }), {
		message: /Location "SO23" was not recognised as a UK place/,
	});
});

test('missing page throws the server sentence', async () => {
	await assert.rejects(run({ resource: 'page', operation: 'getMarkdown', path: '/no-such-page-zz' }), {
		message: /Markdown fetch failed with 404/,
	});
});

test('unknown reference throws the server sentence', async () => {
	await assert.rejects(run({ resource: 'trader', operation: 'get', publicReference: 'nope' }), {
		message: /That listing is not on the public directory/,
	});
});
