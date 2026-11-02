# Journeys: BEFORE

Measured by `npm run perf` (`scripts/perf-journeys.js`) on the mocked SharePoint with 400 ms on every request. It is the fake, not the real site.

| Journey | Requests | Longest chain to a usable screen | kB received | Time to usable (s) |
|---|---:|---:|---:|---:|
| Participant boot, a QR scan | 12 | 4 | 22.4 | 1.6 |
| Welcome, its first minute | 14 | 2 | 26.6 | 0.8 |
| The hub: Welcome, hub, quiz, hub, finale | 15 | 2 | 57.1 | 0.8 |
| Answering: single-select | 3 | 1 | 1.4 | 0.4 |
| Answering: multi-select | 3 | 1 | 1.6 | 0.4 |
| Answering: true-false | 3 | 1 | 1.8 | 0.4 |
| Answering: confidence-continuum | 3 | 1 | 1.9 | 0.4 |
| Answering: ranked-voting | 3 | 1 | 2.1 | 0.4 |
| Answering: open-text-feedback | 3 | 1 | 2.2 | 0.4 |
| Answering: art-of-the-possible | 3 | 1 | 2.5 | 0.4 |
| The finale | 1 | 1 | 1.2 | 0.4 |
| Admin sign-in | 3 | 3 | 1.0 | 1.2 |
| Today | 4 | 3 | 223.7 | 1.2 |
| Clients | 2 | 2 | 17.9 | 0.8 |
| Content, one client | 3 | 2 | 21.3 | 0.8 |
| Guests, 30 guests | 3 | 3 | 38.2 | 1.2 |
| Results, Sessions, 20 sessions | 110 | 5 | 567.9 | 2.0 |
| Results, Dashboard, 40 summaries | 3 | 2 | 44.8 | 0.8 |
| People, 60 users | 4 | 1 | 63.6 | 0.4 |
| Live display, one refresh | 2 | 2 | 13.6 | 0.8 |

<!-- rows: [{"name":"Participant boot, a QR scan","requests":12,"chain":4,"bytes":22969},{"name":"Welcome, its first minute","requests":14,"chain":2,"bytes":27256},{"name":"The hub: Welcome, hub, quiz, hub, finale","requests":15,"chain":2,"bytes":58440},{"name":"Answering: single-select","requests":3,"chain":1,"bytes":1459},{"name":"Answering: multi-select","requests":3,"chain":1,"bytes":1618},{"name":"Answering: true-false","requests":3,"chain":1,"bytes":1797},{"name":"Answering: confidence-continuum","requests":3,"chain":1,"bytes":1955},{"name":"Answering: ranked-voting","requests":3,"chain":1,"bytes":2109},{"name":"Answering: open-text-feedback","requests":3,"chain":1,"bytes":2288},{"name":"Answering: art-of-the-possible","requests":3,"chain":1,"bytes":2564},{"name":"The finale","requests":1,"chain":1,"bytes":1196},{"name":"Admin sign-in","requests":3,"chain":3,"bytes":1048},{"name":"Today","requests":4,"chain":3,"bytes":229036},{"name":"Clients","requests":2,"chain":2,"bytes":18300},{"name":"Content, one client","requests":3,"chain":2,"bytes":21859},{"name":"Guests, 30 guests","requests":3,"chain":3,"bytes":39131},{"name":"Results, Sessions, 20 sessions","requests":110,"chain":5,"bytes":581513},{"name":"Results, Dashboard, 40 summaries","requests":3,"chain":2,"bytes":45829},{"name":"People, 60 users","requests":4,"chain":1,"bytes":65122},{"name":"Live display, one refresh","requests":2,"chain":2,"bytes":13916}] -->
