# Urja Meter Ops --- Portal Protocol Notes

## 1. Purpose and investigation method

This document records the observed behavior of the Urja Meter Ops portal
and explains how the adapter uses its available endpoints.

-   **Investigation date:** 28 October 2026, with implementation and
    testing continuing on 29 October 2026.
-   **Method:** Read-only inspection as a normal authenticated user
    using browser DevTools Network and same-origin requests.
-   **Portal:** `https://urja-ops.flockenergy.tech`
-   **Scope:** Authentication, JSON endpoints, response formats,
    pagination, hierarchy, consumption readings, and data-quality
    issues.

Evidence labels used throughout:

-   **\[Observed\]** Directly seen in a portal response or reproduced
    during testing.
-   **\[Inferred\]** A reasoned interpretation of observed behavior, not
    a guaranteed portal contract.
-   **\[Implementation\]** Behavior implemented by this adapter.
-   **\[Unverified\]** Not conclusively investigated or established.

The portal was inspected read-only. This document does not assume that
an observed implementation detail is a permanent API guarantee.

## 2. Portal overview

-   \[Observed\] The portal is available at
    `https://urja-ops.flockenergy.tech`.
-   \[Observed\] The interface includes a Meters page, meter details, a
    Transformers page, an "Export all meters" action, and a sign-out
    option.
-   \[Observed\] The inspected pages retrieve JSON data from endpoints
    under `/portal/`.
-   \[Inferred\] The application uses SvelteKit, based on its client
    assets and the observed `__data.json` request format.
-   \[Observed\] `/meters/__data.json?...` returned user layout
    information, including name and email, rather than the meter
    dataset.

The adapter uses JSON responses rather than scraping rendered HTML.

## 3. Authentication and session management

### Login

-   \[Observed\] Login uses `POST /login`.
-   \[Observed\] The form fields are `email` and `password`.
-   \[Observed\] The request uses `Accept: application/json`.
-   \[Observed\] A successful login returned HTTP 200 with a JSON
    response equivalent to:

``` json
{
  "type": "redirect",
  "status": 303,
  "location": "/meters"
}
```

-   \[Observed\] The response included a session cookie named
    `__Secure-better-auth.session_token`. The cookie value is
    intentionally omitted from this documentation.
-   \[Observed\] The cookie included `Max-Age=3600`, `Path=/`,
    `HttpOnly`, `Secure`, and `SameSite=Lax`.
-   \[Observed\] Requests to `/portal/*` without a valid session
    returned HTTP 401 with a JSON error indicating that a valid session
    is required.
-   \[Observed\] The inspected data responses did not include
    `Set-Cookie`, so those requests did not visibly renew the session.
-   \[Inferred\] The login response resembles a framework form-action
    redirect response. The cookie name resembles a Better Auth
    session-cookie convention; neither observation establishes the
    server's complete internal implementation.

### Adapter behavior

\[Implementation\] `PortalClient`:

1.  Posts the configured username and password as URL-encoded form data.
2.  Keeps session cookie values in memory.
3.  Shares a single in-flight login between concurrent first requests.
4.  Uses the observed one-hour cookie lifetime as its default when a
    `Max-Age` attribute is unavailable.
5.  Attempts re-authentication approximately 60 seconds before the
    calculated expiry.
6.  On an authentication failure or redirect, clears the current
    session, logs in again, and retries the original request once.
7.  Converts a persistent authentication failure into an upstream error
    instead of forwarding the portal's authentication response directly
    to API clients.
8.  Does not include credentials or cookie values in error messages.

### Authentication limitations

-   \[Unverified\] Whether the `Origin` header is strictly required for
    login. The adapter sends the portal's origin; this is a defensive
    compatibility choice, not a proven requirement.
-   \[Unverified\] Whether repeated login attempts are rate-limited.
-   \[Unverified\] Whether sessions are shared across logins or
    constrained by concurrent usage.
-   \[Unverified\] Whether the server revokes older sessions when a new
    login occurs.
-   \[Unverified\] The portal's complete session-renewal policy.

## 4. Observed portal endpoints

  ---------------------------------------------------------------------------------------
  Endpoint                                Purpose                 Evidence
  --------------------------------------- ----------------------- -----------------------
  `POST /login`                           Authenticate and obtain \[Observed\]
                                          a session cookie

  `GET /portal/meters/search?q=&page=N`   Search and paginate     \[Observed\]
                                          meters

  `GET /portal/meters/{id}/energy`        Retrieve energy         \[Observed\]
                                          readings for a meter

  `GET /portal/meters/{id}/geo`           Retrieve meter          \[Observed\]
                                          coordinates

  `GET /portal/dts?page=N`                Retrieve distribution   \[Observed\]
                                          transformer records

  `GET /portal/export?page=1`             Retrieve meter export   \[Observed\]
                                          data, including
                                          hierarchy and
                                          coordinates

  `GET /portal/keys`                      Purpose and response    \[Unverified\]
                                          structure not
                                          established
  ---------------------------------------------------------------------------------------

The export response was inspected using a response body captured from
browser DevTools.

\[Unverified\] Whether `/portal/export` returns the complete dataset for
every possible page parameter, and whether other export-related
endpoints are required for additional functionality.

\[Unverified\] A separate single-meter detail endpoint was not
established during the investigation. The export already contains many
of the fields displayed on the meter detail page.

## 5. Portal response schemas

### 5.1 Meter search

\[Observed\] The response has the following general structure:

``` json
{
  "data": [
    {
      "meterId": "J100001",
      "serialNo": "...",
      "make": "...",
      "phaseType": "...",
      "installStatus": "Installed",
      "dtCode": "DT-001"
    }
  ],
  "total": 403,
  "page": 1,
  "pageSize": 20
}
```

The example is illustrative; the ellipses are placeholders, not literal
portal values.

Observed fields include `meterId`, `serialNo`, `make`, `phaseType`,
`installStatus`, and `dtCode`.

### 5.2 Export

\[Observed\] The inspected export contained 403 meter records and the
fields needed to construct the adapter's meter, transformer, hierarchy,
and location views.

Each export record includes the search fields and additional fields such
as `installType`, `build`, `hierarchy`, and `geo`.

The hierarchy has seven levels: `zone`, `circle`, `division`,
`subdivision`, `substation`, `feeder`, and `dt`. Each hierarchy entry
contains a `name` and `code`. The export's `geo` object contains numeric
`lat` and `lng` values.

\[Implementation\] The adapter rejects an export whose reported `total`
does not match the number of returned records. This avoids silently
treating a potentially incomplete export as a complete snapshot.

\[Unverified\] Whether the portal can return a legitimately paginated
export under other page parameters. The adapter currently requests page
1 and does not combine multiple export pages.

### 5.3 Transformer records

\[Observed\] The `/portal/dts` response contains transformer fields
including `code`, `name`, `feederCode`, and `capacityKva`.

The adapter's transformer views are derived from export hierarchy data
rather than treating the portal transformer endpoint as the source for
every field. Consequently, the adapter's transformer response is not
intended to be an exact copy of `/portal/dts`.

### 5.4 Geographic data

\[Observed\] `/portal/meters/{id}/geo` returns a `data` object
containing latitude and longitude as strings.

\[Observed\] The export contains latitude and longitude as numbers.

\[Implementation\] The adapter uses coordinates from the export snapshot
and validates coordinate ranges. Invalid or missing coordinates are
returned as `null`, with a corresponding data-quality issue.

### 5.5 Energy readings

\[Observed\] `/portal/meters/{id}/energy` returns a `data` array with
fields such as `timestamp`, `kwh`, `kvah`, and `voltR`. The inspected
readings represented these numeric values as strings.

Example based on the observed response format:

``` json
{
  "data": [
    {
      "timestamp": "24/06/2026 00:00",
      "kwh": "42594.47",
      "kvah": "46002.02",
      "voltR": "230"
    }
  ]
}
```

The values above illustrate the response format; they are not a
guarantee of current portal values.

\[Observed\] The timestamp format is `DD/MM/YYYY HH:mm` and contains no
timezone offset.

\[Implementation\] The adapter converts valid timestamps into
timezone-neutral strings such as `2026-06-24T00:00:00`. It does not
append `Z` or invent a timezone.

\[Implementation\] Numeric energy fields are normalized to numbers where
valid. The original timestamp is preserved in `timestampRaw`.

\[Inferred\] The `kwh` field appears to be a cumulative register because
its values increased by approximately 0.4 over some half-hour intervals.
This interpretation is not established for every meter or reading.

## 6. Search, pagination, and query behavior

### Meter search

-   \[Observed\] The inspected meter search returned 403 total records.
-   \[Observed\] The page size was 20; page 21 contained the remaining
    three records.
-   \[Observed\] Search `q` is case-insensitive and matches substrings
    in meter IDs and serial numbers.
-   \[Observed\] Search `q` does not match the meter's make.
-   \[Observed\] A serial number containing `&`, such as `L&84997`, is
    split incorrectly if the ampersand is not URL-encoded.
-   \[Observed\] An out-of-range page such as page 22 returned HTTP 200
    with an empty `data` array.
-   \[Observed\] Page values such as `0` and `abc` were silently treated
    as page 1 by the portal.
-   \[Observed\] A search with no matches returned HTTP 200 with
    `total: 0`.

### Adapter behavior

\[Implementation\] The adapter encodes meter IDs and search parameters
when constructing portal paths, implements case-insensitive substring
search over meter ID and serial number, applies exact-match filters for
supported meter fields, validates page and page-size inputs rather than
copying the portal's silent page coercion, and limits API page sizes to
prevent unnecessarily large responses.

These are adapter-level decisions. They should not be interpreted as
proof that the upstream portal supports identical filters or validation.

\[Unverified\] Portal sorting rules, additional filter parameters,
support for a larger page size, and the full behavior of export
pagination.

## 7. Network hierarchy and transformer identity

\[Observed\] Each export meter can reference the hierarchy
`Zone → Circle → Division → Subdivision → Substation → Feeder → DT`.

The inspected dataset contained:

  Level           Distinct values observed
  ------------- --------------------------
  Zone                                   3
  Circle                                 6
  Division                              10
  Subdivision                           14
  Substation                            18
  Feeder                                28
  DT                                    40

\[Observed\] Codes are not globally unique across the entire hierarchy.
Some division codes occur under multiple zone/circle paths, some feeder
codes occur under more than one substation, hierarchy code formatting is
inconsistent in places, and missing hierarchy names and codes occur in
the export.

\[Inferred\] A hierarchy node cannot safely be identified using its code
alone.

\[Implementation\] The adapter constructs a nested hierarchy from export
records and retains parent context when grouping transformers.
Transformer groups are identified using their feeder ancestry and
transformer code.

### Missing hierarchy values

\[Observed\] The export analysis found 22 meters with missing hierarchy
fields, comprising 14 missing codes and 8 missing names. The missing
fields were observed at these levels:

-   Circle: 11 affected records.
-   Feeder: 8 affected records.
-   Substation: 3 affected records.

The affected-record counts describe missing-field occurrences at those
levels, not necessarily unique missing hierarchy nodes.

\[Implementation\] Blank source strings are normalized to `null` and
missing hierarchy values are recorded in `dataQuality.issues`.

\[Implementation\] The hierarchy builder uses both code and name within
each parent context rather than merging every occurrence of a code into
a single global node. This is a conservative representation of the
supplied data, not proof that code-and-name pairs are the portal's
official primary keys.

### Transformer naming conflict

\[Observed\] Transformer code `DT-007` has conflicting names in the
inspected data. One record identifies it as `Sanganer DT 7`, while other
records associated with meters `J100400`--`J100402` identify it as
`Old Malviya Nagar Xfmr`.

\[Implementation\] The adapter preserves distinct names instead of
silently selecting one.

\[Implementation\] If a transformer detail lookup by code matches more
than one network path, the adapter returns an ambiguity error rather
than arbitrarily selecting a result.

## 8. Consumption behavior and data quality

\[Observed\] Meter `J100001` returned 337 half-hourly readings from
`23/06/2026 23:30` through `30/06/2026 23:30`.

\[Observed\] Meter `J100400` returned eight daily readings at `00:00`
from 23 June through 30 June 2026.

\[Observed\] The inspected consumption records ended on 30 June 2026,
even though the portal was being inspected in October 2026.

\[Inferred\] The inspected readings may represent a fixed or historical
snapshot rather than current live consumption. This is an inference from
the dates, not a guarantee about the portal's data-refresh schedule.

\[Observed\] A decommissioned meter, `J100000`, still returned energy
readings.

\[Implementation\] The adapter requests readings from
`/portal/meters/{id}/energy` when a consumption request is made. It does
not infer that a decommissioned meter has no readings.

\[Unverified\] Whether other meters have different sampling intervals,
whether energy timestamps represent local civil time, and whether the
endpoint supports date-range parameters.

\[Implementation\] The current adapter does not rely on unverified
upstream `from` or `to` parameters.

## 9. Error handling

### Observed portal behavior

-   \[Observed\] A request for energy data for an unknown meter returned
    HTTP 404 with a JSON `not_found` error.
-   \[Observed\] A portal request without a valid session returned HTTP
    401.
-   \[Unverified\] The complete behavior of portal 5xx responses, rate
    limiting, and concurrent-session failures.

### Adapter behavior

\[Implementation\] The adapter uses a consistent error envelope:

``` json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

The exact code and message depend on the failure.

The adapter distinguishes between invalid client input, a meter not
found in the adapter's export snapshot, a transformer not found or
ambiguous in the constructed network model, upstream
authentication/availability/timeout/response-format failures, and
unexpected internal errors.

\[Implementation\] Upstream failures are not exposed as though they were
client authentication failures. Internal error details and stack traces
are not returned to API clients.

\[Implementation\] The portal client retries an original request once
after detecting an authentication failure or redirect. It does not
implement general retries for arbitrary upstream errors.

## 10. Adapter design decisions

### Export-backed snapshot

\[Implementation\] Meter listing, meter detail, transformer
listing/detail, and network hierarchy use the cached export snapshot.

Reasons:

-   The export includes the hierarchy and location data needed by the
    adapter.
-   It avoids making a separate portal request for each meter during
    listing.
-   It provides one consistent dataset for the adapter's derived network
    views.

The adapter currently requests `/portal/export?page=1`.

### Cache

\[Implementation\] The export snapshot has an in-memory TTL of 10
minutes by default.

\[Inferred\] This is a reasonable initial balance between reducing
repeated upstream requests and refreshing the local snapshot
periodically.

\[Unverified\] The portal's actual data-freshness guarantees. The
ten-minute TTL is an adapter choice, not an upstream requirement.

The cache is process-local. It is not shared between multiple adapter
instances, and it is lost when the process restarts.

### Consumption

\[Implementation\] Consumption data is fetched from the portal on
request and normalized by the adapter. The adapter preserves the raw
timestamp because the source does not provide timezone information.

### Validation and data quality

\[Implementation\] The adapter validates upstream response shapes,
normalizes blank strings to `null`, checks coordinate ranges, and
records data-quality issues for incomplete records.

\[Implementation\] Invalid or incomplete export data is not silently
accepted as a complete snapshot.

### Authentication

\[Implementation\] Authentication is centralized in `PortalClient`, so
routes do not manage cookies or credentials independently.

### Network identity

\[Implementation\] Hierarchy paths are retained when grouping
transformer records because codes alone are not reliably unique across
the observed dataset.

## 11. Known limitations

1.  The adapter's cache is in-memory and process-local.
2.  The ten-minute cache TTL is an assumption; the portal's freshness
    guarantees are unknown.
3.  Portal timestamps have no timezone, so the adapter does not attach
    one.
4.  The adapter's transformer and hierarchy endpoints are derived from
    the export rather than guaranteed upstream endpoints.
5.  Export completeness depends on the observed page-1 response and the
    reported total. Other export pagination behavior remains unverified.
6.  Conflicting transformer names are preserved; the adapter does not
    decide which name is authoritative.
7.  Missing hierarchy fields limit how precisely some records can be
    grouped.
8.  The adapter uses a permissive meter-ID validation pattern rather
    than assuming every future ID follows one specific numbering scheme.
9.  Consumption granularity differs between the inspected meters; the
    reason has not been established.
10. The adapter has not established a complete upstream contract for
    rate limits, sorting, date-range filtering, or concurrent sessions.
11. No general-purpose retry policy is implemented for arbitrary
    upstream failures.

## 12. Open questions and unverified behavior

The following questions remain open unless further evidence is
collected:

-   Is the `Origin` header required for login?
-   What is the exact wrong-password response, and are login attempts
    rate-limited?
-   Are sessions shared, replaced, or invalidated when multiple logins
    occur?
-   What does `/portal/keys` return, and is it necessary for any adapter
    functionality?
-   How does `/portal/export` behave with `page=2`, `page=0`, or no page
    parameter?
-   Does the portal support sorting, additional search filters, or
    larger page sizes?
-   What sampling intervals are used by other meters?
-   Does the energy endpoint support date-range parameters?
-   What are the portal's rate limits and behavior under concurrent
    requests?
-   Does the portal provide a formal guarantee about export freshness or
    data completeness?

These questions should be investigated only when the answer materially
affects the adapter. Until verified, they should remain documented as
unknowns rather than treated as requirements.

## 13. Reproduction and verification

The adapter's automated tests use Node's built-in test runner:

``` powershell
npm test
```

The tests cover parsing, cache behavior, portal-client authentication
handling, meter routes, consumption normalization, and derived
transformer/hierarchy behavior.

\[Observed in the development session\] The supplied test output
reported 45 tests passing and 0 failing after the network-route test
helper was corrected. This is a recorded development result, not a
guarantee that every future checkout or environment will produce the
same result.

Live portal verification requires valid local credentials configured
through environment variables. Credentials and session-cookie values
must not be committed to the repository.

## 14. Evidence discipline

This document deliberately separates observed facts, inferences, adapter
implementation choices, and unverified behavior.

A successful local test proves the tested adapter behavior against its
test inputs; it does not independently prove the upstream portal's
behavior.

Likewise, a single observed response does not establish a permanent
upstream contract.

When further investigation resolves an open question, update this
document with the observation and the conditions under which it was
verified. Do not record credentials, session cookies, or other secrets
in protocol notes.
