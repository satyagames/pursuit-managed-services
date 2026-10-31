# Adding a person: the app's role and the SharePoint site are two steps

A role in **People** (Producer, Designer, Admin, Leadership, Super admin) decides what a person may do **inside** the app. It does not give them access to the
PCOE SharePoint site, where the pages (`index.html`, `admin.html`, `setup.html`) and the sixteen lists live. A person needs both. The app cannot do the
second step for you: it never reads or changes the site's permissions (Prompt 25 changed words only).

*(The brief for this document pointed at `claude/onboarding-sharepoint-access.md`; that file was not in the tree, so this text was written from the brief's
outline and [SHAREPOINT.md](SHAREPOINT.md#who-may-do-what). Check the group names below against the real site.)*

## Which message means what

| What the person sees | Where | What it means | What to do |
|---|---|---|---|
| "Sorry, this item hasn't been shared with you" | SharePoint's own page, before the app loads | They are not on the PCOE site (or not at a level that opens the page). The app never started. | Add them to the site: the steps below. A role in People does not fix this. |
| "You do not have access to *the app* yet" | The app's No access screen | They can open the site, but have no role in People. | A Super admin gives them a role (People, then Give access). |
| "Your access to *the app* is turned off" / "has changed" | The app's No access screen | Their row is turned off, or has no current role, or the end date passed. | A Super admin turns the row on or gives a role again. |
| The page opens but a screen is empty or refuses to save | The app | Usually a role that does not cover that client or session, or site access too low for the lists. | Check the role's client; then the site level below. |

A person who sees the app's No access screen already has site access.

## Add a person to the site

1. Open the PCOE SharePoint site and choose **Settings** (the gear), then **Site permissions**.
2. Choose **Share site** (or **Advanced permissions settings** if your site uses groups).
3. Enter the person's name or email. Pick the level in the table below. Leave "Send an email invitation" on if you want them told.
4. Choose **Share**. Ask them to reload the page they were trying to open.
5. Give them their role in the app: **People**, the person, **Give access**.

Only a site owner (or someone with Full control of the site) can do steps 1 to 4. Ask the site owner if the gear shows no Site permissions.

## The level each role needs

| Role in the app | Site level | Why |
|---|---|---|
| Super admin, Admin, Producer, Designer | **Edit** (the site's Members group) | The admin page writes sessions, content and the visit log, and the library for pictures. |
| Leadership | **Read** (the site's Visitors group) is enough | Leadership reads results, the dashboard and the exports; nothing is written. |
| Participants (iPads, the participant link) | As [SHAREPOINT.md](SHAREPOINT.md#who-may-do-what) lists: Contribute on the lists they write, Read on the rest, no access to `PMSAdminUsers` | The participant page saves answers and the visit log. |

The names Members and Visitors are SharePoint's defaults; a site may call its groups something else. What matters is the level, not the group's name.

## If the error stays

- Ask them to sign out of Microsoft 365 in that browser and sign in with the work account they were added with (a personal account, or a second
  work account, is a different person to SharePoint).
- Check the site's **Site permissions** list for their name; a person added to the app's People list is not there unless you added them.
- Check they were not added to a group that has been given less than Edit on the lists, or had permissions stopped inheriting from the site.
- A link copied from someone else's browser opens the same page, but still asks SharePoint who you are: the link itself never grants access.
- Wait a few minutes after a change, then reload. Send IT the **Details** (the SPRequestGuid) from the error page if it persists.
  A tenant's sign-in rules can differ: [SHAREPOINT.md](SHAREPOINT.md#sessions-tokens-and-the-403).

## The honest limit

The app does not know whether a person can open the site: it only sees people who already got in. So Give access and Add user can only **remind** you
(Prompt 25 added that line to both and to the No access screen). Proposed, not built: Setup listing the site's groups and the level each holds; Give access
checking whether the person can already open the site (needs a permission read that Admins may not be allowed); an "Invite by email" button that sends
the site link.
