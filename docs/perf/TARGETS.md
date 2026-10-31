# Targets (Prompt 26)

Set before anything was changed, against [BEFORE.md](BEFORE.md), and checked with `npm run perf -- --check` (`scripts/perf-journeys.js`).

| Target | How it is held |
|---|---|
| Bytes received down by at least 40% on every journey | `missed()` in `scripts/perf-journeys.js`, each row against BEFORE's |
| No screen has more than 3 sequential requests before it is drawn | the longest chain: the time to a usable screen divided by the delay on each request |
| No admin list read grows with the number of rows beyond one page plus a small index | the paging tests, on 6,000 fake rows |
| A Welcome screen makes at most 12 requests in its first minute | the row "Welcome, its first minute" |

These are the fake's numbers. The real site's are read in DevTools ([DEVTOOLS-NETWORK.md](../DEVTOOLS-NETWORK.md)).
