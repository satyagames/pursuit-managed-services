# Watching the calls in DevTools

How to see what a page asks SharePoint for, on the real site, in Edge or Chrome. It writes nothing and needs no rights beyond opening the page.

1. Open the page, press **F12** and choose the **Network** tab. Tick **Preserve log** and **Disable cache**.
2. Press **Fetch/XHR** in the filter row, and type `_api` in the filter box. Reload the page.
3. The foot of the panel says how many requests were made and how many **kB transferred**. Compare it with [perf/BEFORE.md](perf/BEFORE.md) for the same screen (a real row carries more built-in columns than the fake's).
4. Click a request. **Headers** has the address and `Accept`; **Response** has what came back: since Prompt 26, plain rows under `value` and no `__metadata`. A read by `AppId` or `TrackId` carries `odata.etag` on its row, on purpose: a write checks it.
5. A `$batch` is one request carrying several reads: its **Payload** lists them, one `GET` to a part.
6. The **Waterfall** column shows what waited for what: bars one after another are a chain, bars side by side cost one wait.

**The Console tab.** A refused request is printed in red with the page's name and `:1` beside it (`index.html:1`), because the page is one line. To send it: Console, right-click, **Save as**.

**What is normal.** While a page waits it checks once every 20 seconds or so (one `$batch`); with a question on screen, once a minute; a hidden tab makes none. A `429` or `503` followed by a retry is SharePoint asking for a pause, and the page obeys.
