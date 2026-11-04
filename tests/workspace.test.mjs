import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server;
let data;
let navigation;
let reporting;
let flow;
let diagnosis;
let pages;
let App;

before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
    logLevel: 'error',
  });
  const modules = await Promise.all([
    server.ssrLoadModule('/src/data/mockAsnData.ts'),
    server.ssrLoadModule('/src/utils/navigation.ts'),
    server.ssrLoadModule('/src/utils/reporting.ts'),
    server.ssrLoadModule('/src/utils/journey.ts'),
    server.ssrLoadModule('/src/utils/diagnosis.ts'),
    server.ssrLoadModule('/src/components/WorkspacePages.tsx'),
    server.ssrLoadModule('/src/App.tsx'),
  ]);
  data = modules[0].mockAsnData;
  navigation = modules[1];
  reporting = modules[2];
  flow = modules[3];
  diagnosis = modules[4];
  pages = modules[5];
  App = modules[6].default;
});

after(async () => {
  await server?.close();
});

test('all five workspace hashes resolve without masking an unknown page', () => {
  assert.equal(navigation.workspacePages.length, 5);
  for (const page of navigation.workspacePages) {
    assert.equal(navigation.pageFromHash(`#${page.id}`), page.id);
    assert.equal(navigation.pageFromHash(`#/${page.id}`), page.id);
    assert(page.heading && page.breadcrumb && page.description);
  }
  assert.equal(navigation.pageFromHash(''), 'dashboard');
  assert.equal(navigation.pageFromHash('#/'), 'dashboard');
  assert.equal(navigation.pageFromHash('#does-not-exist'), undefined);
  assert.equal(navigation.pageFromHash('#analytics/unknown'), undefined);
});

test('the sidebar renders real links and shows no stale queue count before MongoDB data loads', () => {
  const html = renderToStaticMarkup(createElement(App));
  for (const page of navigation.workspacePages) assert(html.includes(`href="#${page.id}"`));
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /href="#dashboard" aria-current="page"/);
  assert(html.includes('title="ASNs for the selected day">0</span>'));
  assert(html.includes('Loading ASN journeys from MongoDB'));
});

test('analytics reconciles statuses, providers and routes to the shared selected-day journeys', () => {
  for (const day of ['Today', 'Yesterday', '2 days ago']) {
    const records = data.filter((journey) => journey.day === day);
    const summary = reporting.summarizeJourneys(records);
    assert.equal(summary.total, records.length);
    assert.equal(summary.received, records.filter((journey) => journey.receiptTimestamp).length);
    assert.equal(summary.failed, records.filter((journey) => journey.events.some((event) => event.eventStatus === 'FAILED')).length);
    assert.equal(summary.open, summary.total - summary.received);
    assert.equal(summary.statuses.reduce((sum, bucket) => sum + bucket.count, 0), records.length);
    assert.equal(summary.providers.reduce((sum, bucket) => sum + bucket.total, 0), records.length);
    assert.equal(summary.routes.reduce((sum, bucket) => sum + bucket.total, 0), records.length);
    for (const bucket of summary.providers) {
      assert.equal(bucket.total, records.filter((journey) => journey.sourceProvider === bucket.key).length);
    }
    for (const bucket of summary.routes) {
      assert.equal(bucket.total, records.filter((journey) => journey.route === bucket.key).length);
    }
  }
});

test('analytics keeps repeated Middleware and PI/PO exceptions separate and excludes blocked cascades', () => {
  const healthy = data.find((journey) => journey.route === 'SAP' && journey.status === 'HEALTHY');
  const states = {
    MIDDLEWARE_INBOUND: 'FAILED', SAP_PI_PO_INBOUND: 'UNKNOWN',
    SAP_PI_PO_OUTBOUND: 'PENDING', MIDDLEWARE_OUTBOUND: 'DELAYED', WMS: 'BLOCKED',
  };
  const events = healthy.events.map((event) => states[event.checkpointId] ? { ...event, eventStatus: states[event.checkpointId] } : event);
  const record = { ...healthy, ...diagnosis.assessJourney(events, healthy), events };
  const summary = reporting.summarizeJourneys([record]);
  assert.equal(summary.exceptions.length, 4);
  for (const [id, status] of Object.entries(states)) {
    const bucket = summary.exceptions.find((item) => item.key.endsWith(`:${id}`));
    if (status === 'BLOCKED') assert.equal(bucket, undefined);
    else {
      assert(bucket, id);
      assert.equal(bucket.total, 1);
      assert.equal(bucket[status === 'FAILED' ? 'failed' : status === 'UNKNOWN' ? 'unknown' : 'waiting'], 1);
    }
  }
});

test('analytics and reports reflect recovery without converting it to a confirmed receipt', () => {
  const failed = data.find((journey) => journey.firstFailureCheckpoint === 'SAP_PI_PO_OUTBOUND');
  const recovered = diagnosis.simulateRecovery(failed);
  const summary = reporting.summarizeJourneys([recovered]);
  assert.equal(summary.failed, 0);
  assert.equal(summary.open, 1);
  assert.equal(summary.received, 0);
  assert.equal(summary.statuses.find((bucket) => bucket.key === 'RECOVERED').count, 1);
  const journeyReport = reporting.buildReport([recovered], 'journeys');
  assert.equal(journeyReport.rows[0][journeyReport.headers.indexOf('Journey status')], 'Recovered');
  assert.equal(journeyReport.rows[0][journeyReport.headers.indexOf('Receipt date/time (UTC)')], '');
  const events = reporting.buildReport([recovered], 'events');
  assert.equal(events.rows.length, failed.events.length + 1);
  assert.equal(events.rows.at(-1)[events.headers.indexOf('Event type')], 'SIMULATED_RECOVERY');
});

test('Middleware analytics uses completed in-to-out durations and explicitly excludes missing or recovered timing', () => {
  const healthy = data.find((journey) => journey.status === 'HEALTHY');
  const timed = (minutes, status = 'COMPLETE') => ({
    ...healthy,
    events: healthy.events.map((event) => event.checkpointId === 'MIDDLEWARE_INBOUND' ? {
      ...event, eventStatus: status, inTimestamp: '2026-10-25T10:00:00.000Z',
      outTimestamp: `2026-10-25T10:0${minutes}:00.000Z`,
    } : event),
  });
  const summary = reporting.summarizeJourneys([timed(2), timed(6), timed(8, 'RECOVERED')]);
  const timing = summary.middleware.find((item) => item.id === 'MIDDLEWARE_INBOUND');
  assert.equal(timing.samples, 2);
  assert.equal(timing.excluded, 1);
  assert.equal(timing.averageMinutes, 4);
  const missing = { ...healthy, events: healthy.events.map((event) => event.stageCode === 'MIDDLEWARE' ? { ...event, outTimestamp: null } : event) };
  assert(reporting.summarizeJourneys([missing]).middleware.every((item) => item.averageMinutes === null && item.samples === 0));
  const invalid = timed(2);
  invalid.events = invalid.events.map((event) => event.checkpointId === 'MIDDLEWARE_INBOUND' ? { ...event, outTimestamp: 'invalid-date' } : event);
  assert.throws(() => reporting.summarizeJourneys([invalid]), /Invalid Middleware timestamps/);
});

test('both reports have exact row shapes and preserve supplier fields and technical identifiers', () => {
  const records = data.filter((journey) => journey.day === 'Today');
  const journeys = reporting.buildReport(records, 'journeys');
  assert.equal(journeys.headers.length, 22);
  assert.equal(journeys.rows.length, records.length);
  const first = journeys.rows[0];
  assert.equal(first[journeys.headers.indexOf('Container ID')], records[0].containerId);
  assert.equal(first[journeys.headers.indexOf('Count of POs')], records[0].poCount);
  assert.equal(first[journeys.headers.indexOf('Sum of Singles')], records[0].sumOfSingles);
  const events = reporting.buildReport(records, 'events');
  assert.equal(events.headers.length, 22);
  assert.equal(events.rows.length, records.reduce((sum, journey) => sum + journey.events.length, 0));
  for (const report of [journeys, events]) {
    assert(report.rows.every((row) => row.length === report.headers.length));
    assert(reporting.reportCsv(report).startsWith('\uFEFF'));
  }
  const idocColumn = events.headers.indexOf('SAP IDoc');
  const idoc = events.rows.find((row) => row[idocColumn])[idocColumn];
  assert.equal(typeof idoc, 'string');
  assert.match(idoc, /^0\d{15}$/);
  assert.equal(idoc, flow.checkpointEvent(records[0], 'SAP').idocNumber);
  const messages = events.rows.map((row) => row[events.headers.indexOf('Message ID')]).filter(Boolean);
  assert.equal(new Set(messages).size, messages.length);
});

test('CSV output escapes delimiters, quotes, line breaks and formula-prefixed text without losing zeros', () => {
  const report = {
    headers: ['Text', 'Count'],
    rows: [
      ['Cedar, "Vale"\r\nLine', 7], ['=SUM(1,2)', 0], [' \t+SUM(1,2)', 2],
      ['@SUM(A1)', 3], ['-formula', 4], ['0000000008100000', 5], ['Plain text', -2], ['\u0000=SUM(A1)', 6],
    ],
  };
  const csv = reporting.reportCsv(report);
  assert(csv.startsWith('\uFEFF"Text","Count"\r\n'));
  assert(csv.includes('"Cedar, ""Vale""\r\nLine","7"\r\n'));
  assert(csv.includes('"\'=SUM(1,2)","0"\r\n'));
  assert(csv.includes('"\' \t+SUM(1,2)","2"\r\n'));
  assert(csv.includes('"\'@SUM(A1)","3"\r\n'));
  assert(csv.includes('"\'-formula","4"\r\n'));
  assert(csv.includes('"0000000008100000","5"\r\n'));
  assert(csv.includes('"Plain text","-2"\r\n'));
  assert(csv.includes('"\'\u0000=SUM(A1)","6"\r\n'));
  assert.throws(() => reporting.reportCsv({ headers: ['One'], rows: [['One', 'Extra']] }), /column definitions/);
});

test('empty analytics and reports use explicit empty states rather than invalid metrics', () => {
  const summary = reporting.summarizeJourneys([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.receiptPercent, 0);
  assert(summary.middleware.every((timing) => timing.averageMinutes === null));
  const html = renderToStaticMarkup(createElement(pages.AnalyticsPage, { records: [] }));
  assert(html.includes('No checkpoint exceptions'));
  assert.doesNotMatch(html, /NaN|Infinity/);
  const reportHtml = renderToStaticMarkup(createElement(pages.ReportsPage, { records: [], day: 'Today', onNotify: () => {} }));
  assert(reportHtml.includes('No records are available'));
  assert.match(reportHtml, /<button[^>]+disabled=""/);
});

test('reports previews are bounded while CSV exports include every selected-day record', () => {
  const records = data.filter((journey) => journey.day === 'Today');
  const html = renderToStaticMarkup(createElement(pages.ReportsPage, { records, day: 'Today', onNotify: () => {} }));
  assert(html.includes(`Preview: 8 of ${records.length} rows`));
  assert.equal((html.match(/<tr>/g) ?? []).length, 9);
  assert.equal(reporting.buildReport(records, 'journeys').rows.length, records.length);
});

test('Admin exposes all four configured routes and seven systems without pretending production settings are editable', () => {
  const html = renderToStaticMarkup(createElement(pages.AdminPage, {
    selectedDayCount: data.filter((journey) => journey.day === 'Today').length, totalJourneyCount: data.length,
  }));
  assert(html.includes('Read-only demo configuration'));
  assert.equal((html.match(/class="config-route"/g) ?? []).length, 4);
  assert.equal((html.match(/<tr>/g) ?? []).length, 8);
  for (const label of ['ediTrack', 'OpenText', 'SAP PI/PO', 'SAP', 'GI', 'WMS', 'Middleware']) assert(html.includes(label));
  assert.doesNotMatch(html, /<input|<button|Save settings|type="password"/);
  assert(html.includes('href="#asn-queue"'));
  assert(html.includes(`<dd>${data.length}</dd>`));
});
