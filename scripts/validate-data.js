// Checks referential integrity across server/data/*.json: every ID one record
// points to (sectionIds, questionIds, optionIds, clientId, sessionId, ...)
// actually exists in the target file. Run with: node scripts/validate-data.js
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveClientTheme } from '../migration/src/lib/brand/client-theme.js';
import { LISTS } from '../migration/src/lib/schema/pms-schema.js';
import { LOCAL_FILE, columnsOf } from '../migration/src/lib/schema/pms-schema-meta.js';

const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(import.meta.dirname, '..', 'server', 'data'));

const QUESTION_TYPES = [
  'single-select',
  'multi-select',
  'true-false',
  'confidence-continuum',
  'ranked-voting',
  'open-text-feedback',
];

async function loadJson(name) {
  const text = await readFile(path.join(DATA_DIR, `${name}.json`), 'utf8');
  return JSON.parse(text);
}

/** A list that may not have a file yet (the server reads a missing one as empty). */
const loadOptional = (name) => loadJson(name).catch((error) => {
  if (error.code === 'ENOENT') return [];
  throw error;
});

const errors = [];
const fail = (message) => errors.push(message);

function indexById(list, name) {
  const index = new Map();
  for (const item of list) {
    if (index.has(String(item.id))) fail(`${name}: duplicate id "${item.id}"`);
    index.set(String(item.id), item);
  }
  return index;
}

function checkRefs(items, name, field, targetIndex, targetName, { optional = false } = {}) {
  for (const item of items) {
    const ids = item[field];
    if (ids === undefined) {
      if (!optional) fail(`${name} "${item.id}": missing "${field}"`);
      continue;
    }
    for (const id of ids) {
      if (!targetIndex.has(String(id))) {
        fail(`${name} "${item.id}": ${field} references missing ${targetName} "${id}"`);
      }
    }
  }
}

function checkRef(items, name, field, targetIndex, targetName, { optional = false } = {}) {
  for (const item of items) {
    const id = item[field];
    if (id === undefined || id === null) {
      if (!optional) fail(`${name} "${item.id}": missing "${field}"`);
      continue;
    }
    if (!targetIndex.has(String(id))) {
      fail(`${name} "${item.id}": ${field} references missing ${targetName} "${id}"`);
    }
  }
}

async function main() {
  // Every list of the schema (migration/src/lib/schema/pms-schema.js) has its file; the answers' file may be missing (the server reads none as empty).
  const required = Object.keys(LISTS).filter((key) => !LOCAL_FILE[key]);
  const { clients, sessions, sections, questions, options, qrtokens, adminusers, tracks, appsettings, visitorroster, uservisitlogs, users, roleassignments, auditlog, sessionsummary } =
    Object.fromEntries(await Promise.all(required.map(async (key) => [key, await loadJson(key)])));

  const participantresponses = await loadOptional(LOCAL_FILE.responses);

  const clientIndex = indexById(clients, 'clients');
  const sessionIndex = indexById(sessions, 'sessions');
  const sectionIndex = indexById(sections, 'sections');
  const questionIndex = indexById(questions, 'questions');
  const optionIndex = indexById(options, 'options');
  const tokenIndex = indexById(qrtokens, 'qrtokens');
  const trackIndex = indexById(tracks, 'tracks');
  const visitorIndex = indexById(visitorroster, 'visitorroster');
  indexById(appsettings, 'appsettings');
  indexById(adminusers, 'adminusers');
  indexById(uservisitlogs, 'uservisitlogs');
  // (Prompt 21) who may do what: every assignment is of a person on the list, and of a client there is.
  const userIndex = indexById(users, 'users');
  indexById(roleassignments, 'roleassignments');
  indexById(auditlog, 'auditlog');
  // (Prompt 21, Phase 5) a session's summary is of a session there is, and of its client.
  for (const summary of indexById(sessionsummary, 'sessionsummary').values()) {
    const session = sessionIndex.get(String(summary.id));
    if (!session) fail(`sessionsummary "${summary.id}": references missing session "${summary.id}"`);
    else if (session.clientId !== summary.clientId) fail(`sessionsummary "${summary.id}": its session belongs to client "${session.clientId}"`);
  }
  for (const assignment of roleassignments) {
    if (!userIndex.has(String(assignment.userKey))) fail(`roleassignments "${assignment.id}": references missing person "${assignment.userKey}"`);
    if (assignment.clientId && !clientIndex.has(String(assignment.clientId))) fail(`roleassignments "${assignment.id}": references missing client "${assignment.clientId}"`);
  }
  if (appsettings.length > 1 || appsettings.some((setting) => setting.id !== 'default')) {
    fail('appsettings: expected at most one singleton record with id "default"');
  }

  // clients: slug (it names each day's session), status, and a stored theme that can be applied
  const slugs = new Map();
  for (const client of clients) {
    if (client.slug !== undefined && client.slug !== null) {
      if (typeof client.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(client.slug)) {
        fail(`clients "${client.id}": slug "${client.slug}" must be lower-case letters, digits and single dashes`);
      } else if (slugs.has(client.slug)) {
        fail(`clients "${client.id}": slug "${client.slug}" is also used by "${slugs.get(client.slug)}"`);
      } else slugs.set(client.slug, client.id);
    }
    if (client.status !== undefined && client.status !== null && !['active', 'archived'].includes(client.status)) {
      fail(`clients "${client.id}": invalid status "${client.status}"`);
    }
    if (client.themeVersion !== undefined && client.themeVersion !== null && !Number.isFinite(client.themeVersion)) {
      fail(`clients "${client.id}": themeVersion must be a number`);
    }
    if (client.theme !== undefined && client.theme !== null) {
      if (typeof client.theme !== 'object' || Array.isArray(client.theme)) fail(`clients "${client.id}": theme must be an object`);
      else if (resolveClientTheme(client).source !== 'stored') {
        fail(`clients "${client.id}": theme.tokens are missing, unsafe, or from another version than themeVersion`);
      }
    }
  }

  // sessions -> clients, sections
  checkRef(sessions, 'sessions', 'clientId', clientIndex, 'clients');
  checkRefs(sessions, 'sessions', 'sectionIds', sectionIndex, 'sections');
  // A session no longer lists its tracks (tracks.sessionId points the other way), but
  // tolerate the old array as long as it only names real tracks.
  checkRefs(sessions, 'sessions', 'clientTrackIds', trackIndex, 'tracks', { optional: true });
  for (const session of sessions) {
    if (session.activeSectionId && !session.sectionIds?.includes(session.activeSectionId)) {
      fail(`sessions "${session.id}": activeSectionId "${session.activeSectionId}" is not in its own sectionIds`);
    }
    if (!['not-started', 'in-progress', 'completed'].includes(session.status)) {
      fail(`sessions "${session.id}": invalid status "${session.status}"`);
    }
    if (session.participationMode !== undefined && !['staff', 'client-visit'].includes(session.participationMode)) {
      fail(`sessions "${session.id}": invalid participationMode "${session.participationMode}"`);
    }
    if (session.activityFlow !== undefined && session.activityFlow !== null && !['sequential', 'open'].includes(session.activityFlow)) {
      fail(`sessions "${session.id}": invalid activityFlow "${session.activityFlow}"`);
    }
    // An activity that belongs to a client can only be in that client's sessions.
    for (const sectionId of session.sectionIds ?? []) {
      const owner = sectionIndex.get(String(sectionId))?.clientId;
      if (owner && owner !== session.clientId) {
        fail(`sessions "${session.id}": section "${sectionId}" belongs to client "${owner}", not "${session.clientId}"`);
      }
    }
  }

  // sections -> clients (an activity with no clientId has not been assigned yet)
  checkRef(sections, 'sections', 'clientId', clientIndex, 'clients', { optional: true });

  // sections -> questions (and back-reference)
  checkRefs(sections, 'sections', 'questionIds', questionIndex, 'questions');
  for (const question of questions) {
    const section = sectionIndex.get(String(question.sectionId));
    if (!section) fail(`questions "${question.id}": sectionId references missing section "${question.sectionId}"`);
    else if (!section.questionIds?.includes(question.id)) {
      fail(`questions "${question.id}": not listed in section "${section.id}".questionIds`);
    }
    if (!QUESTION_TYPES.includes(question.type)) {
      fail(`questions "${question.id}": invalid type "${question.type}"`);
    }
    if (question.layout !== undefined && question.layout !== null && !['text-list', 'image-grid'].includes(question.layout)) {
      fail(`questions "${question.id}": invalid layout "${question.layout}"`);
    }
  }

  // questions -> options (and back-reference)
  checkRefs(questions, 'questions', 'optionIds', optionIndex, 'options');
  for (const option of options) {
    const question = questionIndex.get(String(option.questionId));
    if (!question) fail(`options "${option.id}": questionId references missing question "${option.questionId}"`);
    else if (!question.optionIds?.includes(option.id)) {
      fail(`options "${option.id}": not listed in question "${question.id}".optionIds`);
    }
  }
  // Every choice-type question should carry exactly one correct option, or none marked at all.
  for (const question of questions) {
    if (question.type === 'open-text-feedback') continue;
    const questionOptions = options.filter((option) => option.questionId === question.id);
    if (questionOptions.length === 0) {
      fail(`questions "${question.id}" (${question.type}): has no options`);
      continue;
    }
    const correctCount = questionOptions.filter((option) => option.correct === true).length;
    if (correctCount > 1) {
      fail(`questions "${question.id}": more than one option marked correct (${correctCount})`);
    }
  }

  // tracks -> sessions, clients, qrtokens
  checkRef(tracks, 'tracks', 'sessionId', sessionIndex, 'sessions');
  checkRef(tracks, 'tracks', 'clientId', clientIndex, 'clients');
  checkRef(tracks, 'tracks', 'qrTokenId', tokenIndex, 'qrtokens', { optional: true });
  checkRef(tracks, 'tracks', 'visitorId', visitorIndex, 'visitorroster', { optional: true });
  for (const track of tracks) {
    const token = tokenIndex.get(String(track.qrTokenId));
    if (token && token.clientTrackId !== track.id) {
      fail(`tracks "${track.id}": was started by qrtoken "${token.id}", which points at track "${token.clientTrackId}"`);
    }
    const visitor = visitorIndex.get(String(track.visitorId));
    if (visitor && visitor.sessionId !== track.sessionId) {
      fail(`tracks "${track.id}": visitor "${visitor.id}" belongs to session "${visitor.sessionId}"`);
    }
  }

  // participantresponses: one item per participant,
  // { id: trackId, trackId, sessionId, clientId, responses: [{ questionId, answer, firstAnswer, attempts, correct, answeredAt }] }
  indexById(participantresponses, 'participantresponses');
  for (const item of participantresponses) {
    if (item.trackId !== item.id) fail(`participantresponses "${item.id}": trackId must equal id`);
    if (!sessionIndex.has(String(item.sessionId))) fail(`participantresponses "${item.id}": references missing session "${item.sessionId}"`);
    if (item.clientId !== null && item.clientId !== undefined && !clientIndex.has(String(item.clientId))) {
      fail(`participantresponses "${item.id}": references missing client "${item.clientId}"`);
    }
    const track = trackIndex.get(String(item.trackId));
    if (track && track.sessionId !== item.sessionId) fail(`participantresponses "${item.id}": its track belongs to session "${track.sessionId}"`);
    const seen = new Set();
    for (const record of item.responses ?? []) {
      if (seen.has(record.questionId)) fail(`participantresponses "${item.id}": two answers to question "${record.questionId}"`);
      seen.add(record.questionId);
      if (!questionIndex.has(String(record.questionId))) fail(`participantresponses "${item.id}": references missing question "${record.questionId}"`);
      for (const field of ['answer', 'firstAnswer']) {
        if (typeof record[field] === 'string' && record[field].length > 1000) fail(`participantresponses "${item.id}" (question "${record.questionId}"): ${field} is longer than 1000 characters`);
      }
      if (![true, false, null].includes(record.correct)) fail(`participantresponses "${item.id}" (question "${record.questionId}"): correct must be true, false or null`);
      if (!Number.isInteger(record.attempts) || record.attempts < 1) fail(`participantresponses "${item.id}" (question "${record.questionId}"): attempts must be a positive whole number`);
    }
    if (JSON.stringify(item.responses ?? []).length > 60000) fail(`participantresponses "${item.id}": responses are too long for one SharePoint text column`);
  }

  // qrtokens -> clients, sessions
  checkRef(qrtokens, 'qrtokens', 'clientId', clientIndex, 'clients');
  checkRef(qrtokens, 'qrtokens', 'sessionId', sessionIndex, 'sessions');
  checkRef(qrtokens, 'qrtokens', 'clientTrackId', trackIndex, 'tracks', { optional: true });
  checkRef(qrtokens, 'qrtokens', 'visitorId', visitorIndex, 'visitorroster', { optional: true });
  for (const token of qrtokens) {
    if (typeof token.used !== 'boolean') fail(`qrtokens "${token.id}": "used" must be true or false`);
    if (token.clientTrackId && token.used !== true) fail(`qrtokens "${token.id}": has a track but isn't marked used`);
    const track = trackIndex.get(String(token.clientTrackId));
    if (track && track.sessionId !== token.sessionId) {
      fail(`qrtokens "${token.id}": session "${token.sessionId}" but its track is in session "${track.sessionId}"`);
    }
    const visitor = visitorIndex.get(String(token.visitorId));
    if (visitor && visitor.sessionId !== token.sessionId) {
      fail(`qrtokens "${token.id}": visitor "${visitor.id}" belongs to session "${visitor.sessionId}"`);
    }
  }

  for (const setting of appsettings) {
    if (setting.activeSessionId) {
      const active = sessionIndex.get(String(setting.activeSessionId));
      if (!active) fail(`appsettings "${setting.id}": activeSessionId references missing session "${setting.activeSessionId}"`);
      else if (active.status === 'completed') fail(`appsettings "${setting.id}": active session "${active.id}" is completed`);
      else if (setting.activeClientId && active.clientId !== setting.activeClientId) {
        fail(`appsettings "${setting.id}": activeClientId "${setting.activeClientId}" is not the client of the active session "${active.id}"`);
      }
    }
    if (setting.activeClientId && !clientIndex.has(String(setting.activeClientId))) {
      fail(`appsettings "${setting.id}": activeClientId references missing client "${setting.activeClientId}"`);
    }
  }
  for (const visitor of visitorroster) {
    checkRef([visitor], 'visitorroster', 'sessionId', sessionIndex, 'sessions');
    if (typeof visitor.displayName !== 'string' || !visitor.displayName.trim()) {
      fail(`visitorroster "${visitor.id}": displayName must be a non-empty string`);
    }
    if (visitor.enabled !== undefined && typeof visitor.enabled !== 'boolean') {
      fail(`visitorroster "${visitor.id}": enabled must be true or false`);
    }
  }
  for (const visit of uservisitlogs) {
    checkRef([visit], 'uservisitlogs', 'sessionId', sessionIndex, 'sessions', { optional: true });
    checkRef([visit], 'uservisitlogs', 'clientId', clientIndex, 'clients', { optional: true });
    checkRef([visit], 'uservisitlogs', 'visitorId', visitorIndex, 'visitorroster', { optional: true });
    checkRef([visit], 'uservisitlogs', 'trackId', trackIndex, 'tracks', { optional: true });
    const visitor = visitorIndex.get(String(visit.visitorId));
    if (visitor && visit.sessionId && visitor.sessionId !== visit.sessionId) {
      fail(`uservisitlogs "${visit.id}": visitor "${visitor.id}" belongs to session "${visitor.sessionId}"`);
    }
    const track = trackIndex.get(String(visit.trackId));
    if (track && visit.sessionId && track.sessionId !== visit.sessionId) {
      fail(`uservisitlogs "${visit.id}": track "${track.id}" belongs to session "${track.sessionId}"`);
    }
  }

  // Every record against the schema file (Phase 10c-2b): no field the lists do not have, each of the kind the data layer writes, a
  // column of chosen words holding one of its words, and text of one line no longer than its column holds.
  const files = { clients, sessions, sections, questions, options, qrtokens, adminusers, tracks, appsettings, visitorroster, uservisitlogs, participantresponses, users, roleassignments, auditlog, sessionsummary };
  for (const key of Object.keys(LISTS)) {
    const name = LOCAL_FILE[key] ?? key;
    const described = new Map(columnsOf(key).filter((column) => column.field).map((column) => [column.field, column]));
    for (const record of files[name]) {
      for (const [field, value] of Object.entries(record)) {
        if (field === 'id') continue;
        const column = described.get(field);
        if (!column) { fail(`${name} "${record.id}": "${field}" is not a field of the ${LISTS[key].title} list`); continue; }
        if (value === null || value === undefined) continue;
        const kindIsRight = {
          array: Array.isArray(value), object: typeof value === 'object' && !Array.isArray(value), yesno: typeof value === 'boolean',
          number: Number.isFinite(value), date: typeof value === 'string' && !Number.isNaN(Date.parse(value)),
          // (An answer's value is text on SharePoint; locally it may be the number or the yes/no it stands for. The data layer writes it as text.)
          text: typeof value === 'string' || (field === 'value' && ['number', 'boolean'].includes(typeof value)),
        }[column.kind];
        if (!kindIsRight) fail(`${name} "${record.id}": "${field}" should be ${column.kind}, is ${JSON.stringify(value).slice(0, 40)}`);
        if (column.values && !column.values.includes(value)) fail(`${name} "${record.id}": "${field}" is "${value}", not one of ${column.values.join(', ')}`);
        if (column.type === 'Text' && typeof value === 'string' && column.max && value.length > column.max) fail(`${name} "${record.id}": "${field}" is ${value.length} characters, longer than its column's ${column.max}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`✗ ${errors.length} referential integrity error(s):\n`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log(
    `✓ Referential integrity OK — ${clients.length} clients, ${sessions.length} sessions, ${sections.length} sections, ` +
      `${questions.length} questions, ${options.length} options, ${tracks.length} tracks, ` +
      `${participantresponses.length} participant items, ${qrtokens.length} qrtokens, ${adminusers.length} adminusers, ` +
      `${visitorroster.length} visitors, ${uservisitlogs.length} visit logs.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
