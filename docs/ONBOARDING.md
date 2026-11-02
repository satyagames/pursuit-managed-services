# Adding a person: the app's role and the SharePoint site are two steps

A role in **People** (Producer, Designer, Admin, Leadership, Super admin) decides what a person may do **inside** the app. It does not give them access to the
PCOE SharePoint site, where the pages (`index.html`, `admin.html`, `setup.html`) and the sixteen lists live. A person needs both. The app does not do the
second step: a Super admin does, in the app's own SharePoint groups (Prompt 27). Those groups are made once, by a site owner, with **Apply** on the Setup page.
The site also holds other, unrelated content, so nobody belongs in the site's built-in Members or Visitors for the sake of this app.

*(Every SharePoint step of Prompt 27 is ASSUMED until tried on the real site: [QA-TESTING.md](../QA-TESTING.md).)*

## Which message means what

| What the person sees | Where | What it means | What to do |
|---|---|---|---|
| "Sorry, this item hasn't been shared with you" | SharePoint's own page, before the app loads | They are not on the PCOE site (or not at a level that opens the page). The app never started. | Add them to the site: the steps below. A role in People does not fix this. |
| "You do not have access to *the app* yet" | The app's No access screen | They can open the site, but have no role in People. | A Super admin gives them a role (People, then Give access). |
| "Your access to *the app* is turned off" / "has changed" | The app's No access screen | Their row is turned off, or has no current role, or the end date passed. | A Super admin turns the row on or gives a role again. |
| The page opens but a screen is empty or refuses to save | The app | Usually a role that does not cover that client or session, or site access too low for the lists. | Check the role's client; then the site level below. |

A person who sees the app's No access screen already has site access.

## Add a person to the site

1. Give them their role in the app: **People**, the person, **Give access**. An Admin stops here: the person now shows under **Waiting for site access** until a Super admin finishes.
2. A Super admin opens the person in **People** and presses **Open site groups**. It copies the person's email and opens the group's SharePoint page.
3. Choose **New**, paste the email, and choose **Share**. Ask them to reload the page they were trying to open.

**Check site access** on the People page (a Super admin's) lists who is waiting, who has more access than the role says, and who is in a group but not in People. It only reads.

## The group each role needs

| Role in the app | Group | Why |
|---|---|---|
| Super admin, Admin | **PMS staff** and **PMS access managers** | The admin page writes sessions, content and the visit log; these two also write the people lists. |
| Producer, Designer | **PMS staff** | The admin page writes sessions, content and the visit log, and the library for pictures. |
| Leadership | **PMS leadership** | Leadership reads results, the dashboard and the exports; nothing is written. |
| Participants (iPads, the participant link) | **PMS participants**, by a site owner or as IT's directory group | The participant page saves answers and the visit log. It cannot read the five secret lists. |

**PMS super admins** owns the three groups a Super admin changes; a site owner alone chooses who is in it, and in PMS participants. What each group holds on each list is printed on the Setup page and in [SHAREPOINT.md](SHAREPOINT.md#who-may-do-what).

## A site that already has people: the existing PCOE site

Apply removes nobody: people who reach the app through the site's Members or Visitors keep working. When ready, the owner moves them into the PMS groups (**Check site access** lists them as waiting, whichever other group they are in), then presses **Remove the site's groups** on the Setup page. That takes the site's own groups off the app's lists and folder only; it changes nothing else on the site, and until it is pressed anyone in Members can still read the five secret lists.

## If the error stays

- Ask them to sign out of Microsoft 365 in that browser and sign in with the work account they were added with (a personal account, or a second
  work account, is a different person to SharePoint).
- Press **Check site access**; a person added to the app's People list is in no group until a Super admin adds them.
- A link copied from someone else's browser opens the same page, but still asks SharePoint who you are: the link itself never grants access.
- Wait a few minutes after a change, then reload. Send IT the **Details** (the SPRequestGuid) from the error page if it persists.
  A tenant's sign-in rules can differ: [SHAREPOINT.md](SHAREPOINT.md#sessions-tokens-and-the-403).

## The honest limit

The app changes no group's members: Give access and Add user **remind** you, and a Super admin finishes in SharePoint. Proposed, not built: the app adding and
removing members itself, for a Super admin, once the owner's console test on the real site has passed (Part 4 of Prompt 27).
