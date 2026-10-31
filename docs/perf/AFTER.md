# Journeys: AFTER

Measured by `npm run perf` (`scripts/perf-journeys.js`) on the mocked SharePoint with 400 ms on every request. It is the fake, not the real site.

| Journey | Requests | Longest chain to a usable screen | kB received | Time to usable (s) |
|---|---:|---:|---:|---:|
| Participant boot, a QR scan | 10 | 4 | 12.3 | 1.6 |
| Welcome, its first minute | 13 | 2 | 15.9 | 0.8 |
| The hub: Welcome, hub, quiz, hub, finale | 12 | 2 | 14.5 | 0.8 |
| Answering: single-select | 3 | 1 | 1.1 | 0.4 |
| Answering: multi-select | 3 | 1 | 1.3 | 0.4 |
| Answering: true-false | 3 | 1 | 1.4 | 0.4 |
| Answering: confidence-continuum | 3 | 1 | 1.6 | 0.4 |
| Answering: ranked-voting | 3 | 1 | 1.8 | 0.4 |
| Answering: open-text-feedback | 3 | 1 | 1.9 | 0.4 |
| Answering: art-of-the-possible | 3 | 1 | 2.2 | 0.4 |
| The finale | 1 | 1 | 0.6 | 0.4 |
| Admin sign-in | 3 | 3 | 1.1 | 1.2 |
| Today | 4 | 3 | 49.1 | 1.2 |
| Clients | 2 | 2 | 7.0 | 0.8 |
| Content, one client | 3 | 2 | 10.8 | 0.8 |
| Guests, 30 guests | 3 | 3 | 17.1 | 1.2 |
| Results, Sessions, 20 sessions | 9 | 2 | 27.1 | 0.8 |
| Results, Dashboard, 40 summaries | 3 | 2 | 32.7 | 0.8 |
| People, 60 users | 2 | 2 | 19.1 | 0.8 |
| Live display, one refresh | 2 | 2 | 9.9 | 0.8 |

<!-- rows: [{"name":"Participant boot, a QR scan","requests":10,"chain":4,"bytes":12555},{"name":"Welcome, its first minute","requests":13,"chain":2,"bytes":16286},{"name":"The hub: Welcome, hub, quiz, hub, finale","requests":12,"chain":2,"bytes":14810},{"name":"Answering: single-select","requests":3,"chain":1,"bytes":1145},{"name":"Answering: multi-select","requests":3,"chain":1,"bytes":1304},{"name":"Answering: true-false","requests":3,"chain":1,"bytes":1483},{"name":"Answering: confidence-continuum","requests":3,"chain":1,"bytes":1641},{"name":"Answering: ranked-voting","requests":3,"chain":1,"bytes":1795},{"name":"Answering: open-text-feedback","requests":3,"chain":1,"bytes":1974},{"name":"Answering: art-of-the-possible","requests":3,"chain":1,"bytes":2250},{"name":"The finale","requests":1,"chain":1,"bytes":610},{"name":"Admin sign-in","requests":3,"chain":3,"bytes":1105},{"name":"Today","requests":4,"chain":3,"bytes":50292},{"name":"Clients","requests":2,"chain":2,"bytes":7204},{"name":"Content, one client","requests":3,"chain":2,"bytes":11028},{"name":"Guests, 30 guests","requests":3,"chain":3,"bytes":17485},{"name":"Results, Sessions, 20 sessions","requests":9,"chain":2,"bytes":27749},{"name":"Results, Dashboard, 40 summaries","requests":3,"chain":2,"bytes":33482},{"name":"People, 60 users","requests":2,"chain":2,"bytes":19536},{"name":"Live display, one refresh","requests":2,"chain":2,"bytes":10119}] -->
