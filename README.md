# Urja Meter Ops API Adapter

A REST API built with Node.js and Express that adapts the Urja Meter Ops portal into a consistent interface for meter data, consumption readings, network hierarchy, and transformer information.

## Features

- Meter listing, filtering, pagination, and detail lookup.
- Meter consumption readings through the upstream portal.
- Network hierarchy derived from meter export data.
- Transformer listing and lookup.
- In-memory export snapshot caching with a configurable TTL.
- Upstream authentication and session-cookie management.
- Input validation and consistent API error responses.
- Automated tests using Node.js's built-in test runner.

## Tech Stack

- Node.js (>= 22.9)
- Express 5
- Zod 4
- Native Fetch API
- `node:test`

## Prerequisites

- Node.js 22.9 or later.
- npm.
- Valid credentials for the Urja Meter Ops portal.

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a local `.env` file from the example.

PowerShell:

```powershell
Copy-Item .env.example .env
```

Update `.env` with your own portal credentials. Do not commit `.env` or share your credentials.

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Local API server port | `3000` |
| `PORTAL_BASE_URL` | Upstream portal base URL | `https://urja-ops.flockenergy.tech` |
| `PORTAL_USERNAME` | Portal login username | Required |
| `PORTAL_PASSWORD` | Portal login password | Required |
| `PORTAL_TIMEOUT_MS` | Upstream request timeout in milliseconds | `10000` |
| `EXPORT_TTL_MS` | Meter export cache lifetime in milliseconds | `600000` |

Check `.env.example` for the exact configuration expected by the current version.

### 3. Start the server

Development mode:

```bash
npm run dev
```

Normal mode:

```bash
npm start
```

The server listens on the configured port. With the default configuration, the base URL is `http://localhost:3000`.

### 4. Run tests

```bash
npm test
```

Tests use Node.js's built-in test runner. Tests that use mocks or fixtures do not establish that the live upstream portal is currently available.

## API Endpoints

All application endpoints are under `/api/v1`, except `/health`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/v1/meters` | List and filter meters |
| `GET` | `/api/v1/meters/:meterId` | Get one meter |
| `GET` | `/api/v1/meters/:meterId/consumption` | Get consumption readings for a meter |
| `GET` | `/api/v1/hierarchy` | Get the derived network hierarchy |
| `GET` | `/api/v1/transformers` | List and filter derived transformers |
| `GET` | `/api/v1/transformers/:code` | Look up a transformer by code |

### Health check

```http
GET /health
```

Use this endpoint to check whether the API process responds. It does not, by itself, prove that upstream authentication or data retrieval is working.

### List meters

```http
GET /api/v1/meters?page=1&pageSize=20&q=J100001
```

Supported filters include:

- `q`: case-insensitive substring search over meter ID and serial number.
- `status`
- `phaseType`
- `make`
- `installType`
- `build`
- `transformerCode`
- `page`
- `pageSize`

Pagination inputs are validated by the API. The maximum supported page size is 100.

The response contains a paginated collection with `items`, `total`, `page`, and `pageSize`, along with snapshot metadata where provided.

### Get a meter

```http
GET /api/v1/meters/J100001
```

Returns the matching meter in a `data` object. An unknown meter returns a `METER_NOT_FOUND` error.

### Get consumption readings

```http
GET /api/v1/meters/J100001/consumption
```

Returns a meter ID, reading count, and normalized readings.

The adapter parses the upstream timestamp format `DD/MM/YYYY HH:mm` into an ISO-like date-time string without a timezone suffix. It preserves the original timestamp to avoid implying a timezone that the upstream data does not provide.

A meter that is not present in the export snapshot is rejected. If the upstream energy resource is missing for a known meter, the adapter reports an upstream error.

### Get network hierarchy

```http
GET /api/v1/hierarchy
```

Returns a hierarchy derived from meter export records, using the available network levels:

`zone → circle → division → subdivision → substation → feeder → DT`

Hierarchy identity uses codes and names along the path rather than assuming that a code is globally unique.

### List transformers

```http
GET /api/v1/transformers?page=1&pageSize=20&q=DT-007
```

Returns a paginated collection of transformer groups derived from the export snapshot. The results include hierarchy context so that repeated transformer codes can be distinguished by their network paths.

### Look up a transformer

```http
GET /api/v1/transformers/DT-007
```

Returns the transformer when its code resolves unambiguously. If a code occurs on multiple hierarchy paths, the API returns `AMBIGUOUS_TRANSFORMER_CODE` rather than silently choosing one.

## Error Handling

Errors use a consistent JSON structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable explanation"
  }
}
```

Common cases include:

- `400`: invalid request parameters.
- `404`: unknown API route, meter, or transformer.
- `409`: ambiguous transformer code.
- `502`: upstream portal or upstream resource failure.
- `500`: unexpected internal error.

Exact status codes and error codes depend on the specific failure.

## Design Notes

### Upstream access

The adapter uses native Fetch and maintains the upstream session cookie in memory. Authentication is coordinated to avoid unnecessary simultaneous login requests. When an upstream session expires or an authentication failure is detected, the client attempts to authenticate again and retry once.

Credentials and session cookies must not be returned to API clients or committed to source control.

### Caching

Meter export data is cached in memory for the configured `EXPORT_TTL_MS` duration. Concurrent refreshes share a single in-flight refresh. Consumption readings are fetched from the upstream portal rather than being included in the meter export cache.

This cache is process-local; it is not a distributed cache.

### Data quality and timestamps

Blank export values are normalized to `null` where supported by the parser, with data-quality issues recorded for relevant missing or invalid values.

Upstream timestamps do not include a timezone. The adapter therefore does not invent a timezone offset.

## Assumptions and Trade-offs

- The meter export cache uses a default TTL of 10 minutes (`EXPORT_TTL_MS`). Portal data freshness has not been verified, so this trades fewer upstream requests for the possibility of serving stale meter data.
- Consumption readings are fetched live from the portal rather than cached.
- Portal energy timestamps have no timezone information. The API preserves the original timestamp and does not invent a timezone offset.
- Blank export fields become `null` and are reported as data-quality issues instead of being guessed or silently discarded.
- Conflicting upstream transformer information is preserved rather than arbitrarily selecting one value.
- Hierarchy nodes use their full paths because codes can recur under different parents.
- Pagination parameters are validated, with invalid values returning `400`.
- Meter ID validation does not assume a fixed ID format.
- Upstream failures are mapped to appropriate gateway or connectivity errors. An upstream authentication failure is not treated as a failure of the API client's authentication.
- The authentication retry is limited to one re-login and retry after an authentication failure.

## What Was Skipped

- Persistent or shared caching across multiple server instances.
- A web-based user interface.
- Bulk meter operations.
- Consumption date-range filtering.

## What I Would Improve

- Verify the upstream portal's pagination and authentication requirements more thoroughly.
- Confirm the timezone semantics of consumption timestamps.
- Add more integration tests against the live portal.
- Evaluate persistent or shared caching if the API needs to run across multiple server instances.

## Limitations

- The API depends on the upstream portal's availability, authentication, and response formats.
- The meter cache is held in process memory and is not shared across multiple server instances.
- Hierarchy and transformer data are derived from the meter export and may reflect missing or inconsistent upstream fields.
- Consumption history and its sampling frequency depend on the upstream resource.
- The adapter does not modify upstream portal data.

## Further Documentation

See [PROTOCOL.md](./PROTOCOL.md) for observed portal behavior, investigation notes, assumptions, and unresolved questions.

See [openapi.json](./openapi.json) for the OpenAPI 3.1 specification of this API.

See [REFLECTION.md](./REFLECTION.md) for the assignment reflection, including assumptions, the most difficult part, a mistake, and a self-critique.

## Project Structure

```text
src/
  app.js
  server.js
  config/
  middleware/
  parsers/
  routes/
  services/
  utils/
tests/
scripts/
.env.example
.gitignore
package.json
package-lock.json
openapi.json
PROTOCOL.md
README.md
REFLECTION.md
```

## Security

- Keep `.env` out of version control.
- Never commit portal passwords, session cookies, or private export data.
- Use `.env.example` for placeholder configuration only.
- Do not expose internal exception details to API consumers.
- Treat upstream data and authentication as external dependencies.