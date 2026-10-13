# n8n-nodes-tradehand

An [n8n](https://n8n.io) node for [Tradehand](https://tradehand.com).

Tradehand is a UK app where customers find and book local tradespeople, and trade businesses run their admin. This node lets a workflow look up trades, find tradespeople near a postcode or in a town, read what services a trader offers, and read Tradehand pages as markdown.

No credentials needed.

## Install

In n8n, go to **Settings > Community Nodes**, choose **Install**, and enter `n8n-nodes-tradehand`.

## Operations

### Trader

**Search** finds tradespeople of one trade.

| Field | What to enter |
| --- | --- |
| Trade | Pick from the list, or use an expression such as `electrician` |
| Search By | Postcode, Town or City, or Anywhere |
| Postcode | A full UK postcode, such as `SO23 9LS` (when searching by postcode) |
| Town or City | A UK town, city or borough, such as `Winchester` (when searching by town or city) |
| Max Results | 1 to 20, default 10 |

Returns one item per trader:

```json
{
  "publicReference": "orsidaen-electrical-services",
  "name": "Orsidaen Electrical Services",
  "trade": "Electrician",
  "matchedTrade": "Electrician",
  "location": "Winchester, SO23",
  "claimed": false,
  "accreditations": [],
  "sourceRegister": null,
  "sourceCheckedAt": null,
  "profileUrl": "https://tradehand.com/electricians/uk/winchester/orsidaen-electrical-services"
}
```

**Get** returns one trader.

| Field | What to enter |
| --- | --- |
| Public Reference | The `publicReference` from a Search result |

Returns the trader: `publicReference`, `name`, `trade`, `claimed`, `accreditations`, `profileUrl` and `actions`.

**Get Services** returns the trader together with the services they offer.

| Field | What to enter |
| --- | --- |
| Public Reference | The `publicReference` from a Search result |

```json
{
  "publicReference": "bespoke-gas-ltd-so30",
  "name": "Bespoke Gas Ltd",
  "trade": "heating_engineer",
  "claimed": true,
  "accreditations": ["gas-safe", "oftec", "f-gas"],
  "profileUrl": "https://tradehand.com/heating-engineers/uk/winchester/bespoke-gas-ltd-so30",
  "actions": ["instant_quote", "catalogue"],
  "services": ["Boiler installation", "Boiler repair", "Boiler service"]
}
```

### Trade

**Get Many** lists the trades Tradehand covers.

| Field | What to enter |
| --- | --- |
| Search | Optional text to match against trade names |
| Return All | Turn on to return every match |
| Limit | How many trades to return when Return All is off |

Returns one item per trade:

```json
{ "value": "plumber", "label": "Plumber", "plural": "Plumbers" }
```

### Page

**Get Markdown** reads a Tradehand page as markdown.

| Field | What to enter |
| --- | --- |
| Path | A page path on tradehand.com, such as `/pricing`. Default `/` |

```json
{ "path": "/pricing", "markdown": "# More work, won for you.\n\nRun your business free. ..." }
```

## Errors

When Tradehand cannot answer, the node stops with Tradehand's own message, for example `Location "SO23" was not recognised as a UK place`. Turn on **Continue On Fail** in the node settings to keep going and receive the message in an `error` field instead.

## Example workflow

Find electricians for each row of a Google Sheet and post the top three to Slack.

1. **Google Sheets**: read rows with the columns `trade` and `postcode`.
2. **Tradehand**: Trader > Search. Set Trade to the expression `{{ $json.trade }}`, Search By to Postcode, Postcode to `{{ $json.postcode }}`, and Max Results to 3.
3. **Slack**: send a message with `{{ $json.name }}, {{ $json.location }}: {{ $json.profileUrl }}`.

## Links

- [tradehand.com](https://tradehand.com)
- [Tradehand OpenAPI description](https://tradehand.com/.well-known/openapi.json)

## Licence

[MIT](LICENSE)
