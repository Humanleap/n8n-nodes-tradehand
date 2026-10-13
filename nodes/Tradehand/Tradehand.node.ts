import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodeProperties,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

type Ctx = IExecuteFunctions | ILoadOptionsFunctions;

const MCP_URL = 'https://tradehand.com/api/mcp';
const PAGE_SIZE = 20;

/** One Tradehand tool call. Returns the tool's raw result, or throws the server's own sentence. */
async function callTool(
	ctx: Ctx,
	name: string,
	args: IDataObject,
	itemIndex?: number,
): Promise<IDataObject> {
	let status: number;
	let response: IDataObject;
	try {
		const full = (await ctx.helpers.httpRequest({
			method: 'POST',
			url: MCP_URL,
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				'MCP-Protocol-Version': '2025-06-18',
			},
			body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
			json: true,
			// Tradehand reports failures as a JSON-RPC error body, sometimes with HTTP 500.
			ignoreHttpStatusErrors: true,
			returnFullResponse: true,
		})) as { statusCode: number; body: IDataObject };
		status = full.statusCode;
		response = full.body;
	} catch (error) {
		throw new NodeApiError(ctx.getNode(), error as JsonObject, { itemIndex });
	}

	const node = ctx.getNode();
	const rpcError = response?.error as IDataObject | undefined;
	if (rpcError) {
		throw new NodeApiError(node, rpcError as JsonObject, {
			message: rpcError.message as string,
			itemIndex,
		});
	}
	if (status >= 300) {
		throw new NodeApiError(node, { body: response } as JsonObject, {
			message: `Tradehand returned HTTP ${status}`,
			httpCode: String(status),
			itemIndex,
		});
	}
	const result = response?.result as IDataObject | undefined;
	if (!result) throw new NodeOperationError(node, 'Tradehand returned no result', { itemIndex });

	const structured = result.structuredContent as IDataObject | undefined;
	const blockers = structured?.outcome === 'blocked' ? (structured.blockers as IDataObject[]) : [];
	if (blockers.length) {
		throw new NodeOperationError(node, blockers[0].message as string, { itemIndex });
	}
	if (result.isError) {
		const text = (result.content as IDataObject[] | undefined)?.[0]?.text as string | undefined;
		throw new NodeOperationError(node, text ?? 'Tradehand returned an error', { itemIndex });
	}
	return result;
}

/** The structured payload of a tool result; throws when the server sent none. */
function structuredOf(ctx: Ctx, result: IDataObject, itemIndex?: number): IDataObject {
	const structured = result.structuredContent as IDataObject | undefined;
	if (!structured)
		throw new NodeOperationError(ctx.getNode(), 'Tradehand returned no data', { itemIndex });
	return structured;
}

/** Pages through browse_trades until `max` trades or the last page. */
async function browseTrades(ctx: Ctx, query: string, max: number, itemIndex?: number) {
	const trades: IDataObject[] = [];
	let cursor: string | undefined;
	do {
		const result = await callTool(
			ctx,
			'browse_trades',
			{ query: query || undefined, cursor, limit: Math.min(PAGE_SIZE, max - trades.length) },
			itemIndex,
		);
		const page = structuredOf(ctx, result, itemIndex).data as {
			trades: IDataObject[];
			nextCursor: string | null;
		};
		trades.push(...page.trades);
		cursor = page.nextCursor ?? undefined;
	} while (cursor && trades.length < max);
	return trades;
}

const reference = (resourceOperation: string): INodeProperties => ({
	displayName: 'Public Reference',
	name: 'publicReference',
	type: 'string',
	required: true,
	default: '',
	placeholder: 'e.g. bespoke-gas-ltd-so30',
	description: 'The publicReference of a trader, as returned by Trader > Search',
	displayOptions: { show: { resource: ['trader'], operation: [resourceOperation] } },
});

export class Tradehand implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Tradehand',
		name: 'tradehand',
		icon: { light: 'file:tradehand.svg', dark: 'file:tradehand.dark.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Find UK tradespeople, their services and Tradehand pages',
		defaults: { name: 'Tradehand' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Page', value: 'page' },
					{ name: 'Trade', value: 'trade' },
					{ name: 'Trader', value: 'trader' },
				],
				default: 'trader',
			},

			// Trader
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['trader'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						action: 'Get a trader',
						description: 'Get one trader from the public directory',
					},
					{
						name: 'Get Services',
						value: 'getServices',
						action: 'Get the services of a trader',
						description: 'Get a trader along with the services they offer',
					},
					{
						name: 'Search',
						value: 'search',
						action: 'Search traders',
						description: 'Find traders of one trade near a postcode or in a town',
					},
				],
				default: 'search',
			},
			{
				displayName: 'Trade Name or ID',
				name: 'trade',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTrades' },
				required: true,
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: { show: { resource: ['trader'], operation: ['search'] } },
			},
			{
				displayName: 'Search By',
				name: 'searchBy',
				type: 'options',
				options: [
					{ name: 'Anywhere', value: 'anywhere' },
					{ name: 'Postcode', value: 'postcode' },
					{ name: 'Town or City', value: 'location' },
				],
				default: 'postcode',
				description: 'How to narrow the search to an area',
				displayOptions: { show: { resource: ['trader'], operation: ['search'] } },
			},
			{
				displayName: 'Postcode',
				name: 'postcode',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. SO23 9LS',
				description: 'A full UK postcode',
				displayOptions: {
					show: { resource: ['trader'], operation: ['search'], searchBy: ['postcode'] },
				},
			},
			{
				displayName: 'Town or City',
				name: 'location',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. Winchester',
				description: 'A UK town, city or borough',
				displayOptions: {
					show: { resource: ['trader'], operation: ['search'], searchBy: ['location'] },
				},
			},
			{
				displayName: 'Max Results',
				name: 'maxResults',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: PAGE_SIZE },
				default: 10,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['trader'], operation: ['search'] } },
			},
			reference('get'),
			reference('getServices'),

			// Trade
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['trade'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many trades',
						description: 'List the trades Tradehand covers',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Search',
				name: 'query',
				type: 'string',
				default: '',
				placeholder: 'e.g. elec',
				description: 'Only return trades whose name matches this text',
				displayOptions: { show: { resource: ['trade'], operation: ['getAll'] } },
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { resource: ['trade'], operation: ['getAll'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['trade'], operation: ['getAll'], returnAll: [false] },
				},
			},

			// Page
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['page'] } },
				options: [
					{
						name: 'Get Markdown',
						value: 'getMarkdown',
						action: 'Get a page as markdown',
						description: 'Read a public Tradehand page as markdown',
					},
				],
				default: 'getMarkdown',
			},
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '/',
				placeholder: 'e.g. /pricing',
				description: 'The page path on tradehand.com',
				displayOptions: { show: { resource: ['page'], operation: ['getMarkdown'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async getTrades(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const trades = await browseTrades(this, '', Infinity);
				return trades.map((t) => ({ name: t.label as string, value: t.value as string }));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const returnData: INodeExecutionData[] = [];
		const items = this.getInputData();

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const rows: IDataObject[] = [];

				if (resource === 'trader' && operation === 'search') {
					const searchBy = this.getNodeParameter('searchBy', i) as string;
					const result = await callTool(
						this,
						'search_traders',
						{
							trade: this.getNodeParameter('trade', i) as string,
							limit: this.getNodeParameter('maxResults', i) as number,
							[searchBy]: searchBy === 'anywhere' ? undefined : this.getNodeParameter(searchBy, i),
						},
						i,
					);
					rows.push(...(structuredOf(this, result, i).listings as IDataObject[]));
				} else if (resource === 'trader') {
					const result = await callTool(
						this,
						operation === 'get' ? 'get_trader' : 'get_service_options',
						{ publicReference: this.getNodeParameter('publicReference', i) as string },
						i,
					);
					const { trader, services } = structuredOf(this, result, i).data as {
						trader: IDataObject;
						services?: string[];
					};
					rows.push(operation === 'get' ? trader : { ...trader, services });
				} else if (resource === 'trade') {
					const max = this.getNodeParameter('returnAll', i)
						? Infinity
						: (this.getNodeParameter('limit', i) as number);
					rows.push(
						...(await browseTrades(this, this.getNodeParameter('query', i) as string, max, i)),
					);
				} else {
					const path = this.getNodeParameter('path', i) as string;
					const result = await callTool(this, 'get_page_markdown', { path }, i);
					const markdown = (result.content as IDataObject[] | undefined)?.[0]?.text;
					if (typeof markdown !== 'string') {
						throw new NodeOperationError(this.getNode(), 'Tradehand returned no page', {
							itemIndex: i,
						});
					}
					rows.push({ path, markdown });
				}

				for (const json of rows) returnData.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
