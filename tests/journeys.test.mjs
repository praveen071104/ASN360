import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server;
let data;
let flow;
let diagnosis;
let App;

before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
    logLevel: 'error',
  });
  const modules = await Promise.all([
    server.ssrLoadModule('/src/data/mockAsnData.ts'),
    server.ssrLoadModule('/src/utils/journey.ts'),
    server.ssrLoadModule('/src/utils/diagnosis.ts'),
    server.ssrLoadModule('/src/App.tsx'),
  ]);
  data = modules[0].mockAsnData;
  flow = modules[1];
  diagnosis = modules[2];
  App = modules[3].default;
});

after(async () => {
  await server?.close();
});

for (const provider of ['EDITRACK', 'OPEN_TEXT']) {
  for (const route of ['SAP', 'GI']) {
    test(`${provider} supports the exact ${route} route independently`, () => {
      const stages = flow.getJourneyStages(provider, route);
      assert.deepEqual(stages.map((stage) => stage.code), route === 'SAP'
        ? [provider, 'MIDDLEWARE', 'SAP_PI_PO', 'SAP', 'SAP_PI_PO', 'MIDDLEWARE', 'WMS']
        : [provider, 'MIDDLEWARE', 'GLOBAL_INBOUND', 'MIDDLEWARE', 'WMS']);
      assert.equal(new Set(stages.map((stage) => stage.id)).size, stages.length);
      assert.deepEqual(stages.map((stage) => stage.sequence), stages.map((_, index) => index + 1));
      assert(data.some((journey) => journey.sourceProvider === provider && journey.route === route && journey.day === 'Today'));
    });
  }
}

test('every mock journey has the complete declared route and consistent supplier totals', () => {
  for (const journey of data) {
    const events = flow.checkpointEvents(journey.events);
    const stages = flow.getJourneyStages(journey.sourceProvider, journey.route);
    assert.deepEqual(events.map((event) => [event.checkpointId, event.stageCode, event.stageSequence]),
      stages.map((stage) => [stage.id, stage.code, stage.sequence]), journey.asnId);
    assert.equal(journey.poCount, journey.poNumbers.length);
    assert.equal(new Set(journey.poNumbers).size, journey.poCount);
    assert(journey.sumOfSingles > journey.shippedUrnCount);
    assert.equal(journey.isMock, true);
    if (journey.status === 'HEALTHY') {
      assert.equal(journey.receivedUrnCount, journey.shippedUrnCount);
      assert.equal(journey.asnStatus, 'RECEIVED');
      assert(journey.receiptTimestamp);
    } else {
      assert.equal(journey.receiptTimestamp, undefined);
      assert.notEqual(journey.asnStatus, 'RECEIVED');
    }
  }
});

test('business field availability follows the matrix without treating technical-only systems as missing evidence', () => {
  for (const journey of data) {
    for (const event of flow.checkpointEvents(journey.events)) {
      const supported = flow.systemDetails[event.stageCode].exposesBusinessFields;
      assert.equal(Boolean(event.businessFields), supported && event.eventTimestamp !== null);
      if (event.businessFields) {
        assert.equal(event.businessFields.containerId, journey.containerId);
        assert.equal(event.businessFields.poCount, journey.poCount);
        assert.equal(event.businessFields.sumOfSingles, journey.sumOfSingles);
      }
    }
  }
  const healthy = data.find((journey) => journey.route === 'SAP' && journey.status === 'HEALTHY');
  assert.deepEqual(diagnosis.calculateJourneyState(healthy.events, healthy), { rag: 'GREEN', status: 'HEALTHY' });
});

test('repeated Middleware and PI/PO visits retain distinct identifiers and timestamp evidence', () => {
  const journey = data.find((record) => record.route === 'SAP' && record.status === 'HEALTHY');
  const middleware = journey.events.filter((event) => event.stageCode === 'MIDDLEWARE');
  const pi = journey.events.filter((event) => event.stageCode === 'SAP_PI_PO');
  assert.equal(middleware.length, 2);
  assert.equal(pi.length, 2);
  assert.notEqual(middleware[0].messageId, middleware[1].messageId);
  assert.notEqual(pi[0].messageId, pi[1].messageId);
  const sap = flow.checkpointEvent(journey, 'SAP');
  for (const event of pi) {
    assert(event.idocNumber);
    assert.equal(event.idocNumber, sap.idocNumber);
  }
  for (const event of middleware) {
    assert(event.messageId);
    assert(event.inTimestamp);
    assert(event.outTimestamp);
    assert(event.ibdTimestamp);
    assert(event.obdTimestamp);
    assert(Date.parse(event.inTimestamp) <= Date.parse(event.ibdTimestamp));
    assert(Date.parse(event.ibdTimestamp) <= Date.parse(event.obdTimestamp));
    assert(Date.parse(event.obdTimestamp) <= Date.parse(event.outTimestamp));
  }
  assert.match(sap.idocNumber, /^\d{16}$/);
  assert.notEqual(sap.idocNumber, journey.asnId);
  assert.equal(flow.checkpointEvent(journey, 'MIDDLEWARE_OUTBOUND'), middleware[1]);
  assert.equal(flow.checkpointEvent(journey, 'SAP_PI_PO_OUTBOUND'), pi[1]);
});

test('mock evidence has real date/time values within its selected day and no evidence for blocked checkpoints', () => {
  const today = new Date();
  for (const journey of data) {
    const expectedDay = new Date(today);
    expectedDay.setDate(expectedDay.getDate() - (journey.day === 'Today' ? 0 : journey.day === 'Yesterday' ? 1 : 2));
    assert.equal(new Date(journey.dispatchTimestamp).toDateString(), expectedDay.toDateString());
    for (const event of journey.events) {
      for (const value of [event.eventTimestamp, event.inTimestamp, event.outTimestamp, event.ibdTimestamp, event.obdTimestamp]) {
        if (!value) continue;
        assert(Number.isFinite(Date.parse(value)));
        assert(Date.parse(value) <= Date.now());
        assert.equal(new Date(value).toDateString(), expectedDay.toDateString());
      }
      if (['BLOCKED', 'NOT_STARTED', 'UNKNOWN'].includes(event.eventStatus)) {
        assert.equal(event.eventTimestamp, null);
        assert.equal(event.ibdTimestamp, null);
        assert.equal(event.obdTimestamp, null);
        assert.equal(event.sourceReference, undefined);
        assert.equal(event.messageId, undefined);
        assert.equal(event.idocNumber, undefined);
        assert.equal(event.businessFields, undefined);
      }
    }
  }
});

test('search covers containers, all POs, both message legs, SAP IDoc, providers and routes', () => {
  const journey = data.find((record) => record.route === 'SAP' && record.status === 'HEALTHY');
  const needles = [
    journey.containerId, ...journey.poNumbers, journey.urnId, journey.articleNumber, journey.trailerNumber,
    flow.systemDetails[journey.sourceProvider].label, flow.routeLabels[journey.route],
    ...journey.events.flatMap((event) => [event.messageId, event.idocNumber]).filter(Boolean),
  ];
  for (const needle of needles) assert(flow.matchesJourneyQuery(journey, `  ${needle.toLowerCase()}  `), needle);
  assert(flow.matchesJourneyQuery(journey, ''));
  assert.equal(flow.matchesJourneyQuery(journey, 'not-an-existing-reference'), false);
});

test('diagnosis locates the exact repeated checkpoint and assigns the corresponding owner', () => {
  for (const journey of data.filter((record) => record.status === 'AT_RISK')) {
    const result = diagnosis.diagnoseJourney(journey.events, journey);
    const failed = journey.events.find((event) => event.eventStatus === 'FAILED');
    assert.equal(result.failure.checkpointId, failed.checkpointId);
    assert.equal(journey.currentCheckpoint, failed.checkpointId);
    assert.equal(journey.firstFailureCheckpoint, failed.checkpointId);
    assert.equal(journey.currentOwner, flow.systemDetails[failed.stageCode].owner);
    assert(journey.diagnosis.startsWith(flow.checkpointLabel(failed)));
    if (result.lastSuccess) assert(result.lastSuccess.stageSequence < failed.stageSequence);
  }
  const outbound = data.find((record) => record.firstFailureCheckpoint === 'SAP_PI_PO_OUTBOUND');
  assert.equal(outbound.lastSuccessfulCheckpoint, 'SAP');
  assert.match(outbound.diagnosis, /from SAP/);
});

test('missing, duplicate, mismatched or unknown checkpoint evidence cannot produce a healthy journey', () => {
  const journey = data.find((record) => record.route === 'SAP' && record.status === 'HEALTHY');
  const variants = [
    [],
    journey.events.filter((event) => event.checkpointId !== 'WMS'),
    journey.events.filter((event) => event.checkpointId !== 'MIDDLEWARE_OUTBOUND'),
    [...journey.events, journey.events[1]],
    journey.events.map((event) => event.checkpointId === 'SAP' ? { ...event, eventStatus: 'UNKNOWN' } : event),
  ];
  for (const events of variants) {
    assert.deepEqual(diagnosis.calculateJourneyState(events, journey), { rag: 'GREY', status: 'INCONCLUSIVE' });
    assert.doesNotMatch(diagnosis.diagnoseJourney(events, journey).diagnosis, /receipt is confirmed/);
  }
  assert.equal(diagnosis.calculateJourneyState(journey.events, { ...journey, route: 'GI' }).rag, 'GREY');
  assert.equal(diagnosis.calculateJourneyState([...journey.events].reverse(), journey).rag, 'GREEN');
});

test('inconclusive evidence and recovered-but-unconfirmed journeys keep their existing RAG semantics', () => {
  assert(data.some((journey) => journey.status === 'INCONCLUSIVE'));
  assert(data.some((journey) => journey.status === 'RECOVERED'));
  for (const journey of data) {
    assert.equal(journey.status, diagnosis.calculateJourneyState(journey.events, journey).status);
    assert.equal(journey.ragStatus, diagnosis.calculateJourneyState(journey.events, journey).rag);
    if (journey.status === 'INCONCLUSIVE') assert.equal(journey.ragStatus, 'GREY');
    if (journey.status === 'RECOVERED') assert.equal(journey.ragStatus, 'AMBER');
  }
});

test('recovery targets only the intended checkpoint and never invents downstream timestamps or receipt evidence', () => {
  for (const journey of data.filter((record) => diagnosis.recoveryTarget(record))) {
    const original = structuredClone(journey);
    const target = diagnosis.recoveryTarget(journey);
    const before = flow.checkpointEvents(journey.events);
    const targetIndex = before.findIndex((event) => event.checkpointId === target.checkpointId);
    const now = new Date(Date.now() + 60_000).toISOString();
    const recovered = diagnosis.simulateRecovery(journey, now);
    const afterEvents = flow.checkpointEvents(recovered.events);
    const updated = flow.checkpointEvent(recovered, target.checkpointId);
    assert.deepEqual(journey, original, 'Recovery must not mutate the original mock journey');
    assert.equal(afterEvents.length, before.length);
    assert.equal(updated.retryCount, target.retryCount + 1);
    assert.equal(updated.eventStatus, target.checkpointId === 'WMS' ? 'AWAITING_CONFIRMATION' : 'RECOVERED');
    assert.equal(updated.eventTimestamp, now);
    for (let index = 0; index < before.length; index++) {
      if (index === targetIndex) continue;
      if (index === targetIndex + 1 && ['BLOCKED', 'NOT_STARTED'].includes(before[index].eventStatus)) {
        assert.equal(afterEvents[index].eventStatus, 'AWAITING_CONFIRMATION');
        assert.equal(afterEvents[index].eventTimestamp, before[index].eventTimestamp);
        assert.equal(afterEvents[index].inTimestamp, before[index].inTimestamp);
        assert.equal(afterEvents[index].outTimestamp, before[index].outTimestamp);
        assert.equal(afterEvents[index].ibdTimestamp, before[index].ibdTimestamp);
        assert.equal(afterEvents[index].obdTimestamp, before[index].obdTimestamp);
      } else assert.deepEqual(afterEvents[index], before[index]);
    }
    assert.equal(recovered.receiptTimestamp, journey.receiptTimestamp);
    assert.equal(recovered.receivedUrnCount, journey.receivedUrnCount);
    assert.equal(recovered.asnStatus, journey.asnStatus);
    assert.equal(recovered.status, 'RECOVERED');
    assert.equal(recovered.ragStatus, 'AMBER');
    assert.equal(recovered.statusHistory.at(-1).checkpointId, target.checkpointId);
    assert.equal(recovered.statusHistory.at(-1).toStatus, recovered.status);
    assert.equal(recovered.events.at(-1).eventType, 'SIMULATED_RECOVERY');
    assert.equal(recovered.events.at(-1).checkpointId, target.checkpointId);
  }
});

test('WMS recovery works for failed, delayed, pending and awaiting-confirmation evidence without confirming receipt', () => {
  const healthy = data.find((record) => record.route === 'GI' && record.status === 'HEALTHY');
  for (const status of ['FAILED', 'DELAYED', 'PENDING', 'AWAITING_CONFIRMATION']) {
    const events = healthy.events.map((event) => event.checkpointId === 'WMS' ? { ...event, eventStatus: status } : event);
    const pending = {
      ...healthy, ...diagnosis.assessJourney(events, healthy),
      events, receiptTimestamp: undefined, receivedUrnCount: null, asnStatus: 'DISPATCHED',
    };
    assert.equal(diagnosis.recoveryTarget(pending).checkpointId, 'WMS');
    const recovered = diagnosis.simulateRecovery(pending);
    assert.equal(recovered.currentCheckpoint, 'WMS');
    assert.equal(recovered.ragStatus, 'AMBER');
    assert.equal(recovered.receiptTimestamp, undefined);
    assert.equal(recovered.receivedUrnCount, null);
    assert.equal(flow.checkpointEvent(recovered, 'WMS').eventStatus, 'AWAITING_CONFIRMATION');
  }
});

test('recovery audit entries do not become extra lifecycle checkpoints or substitute for WMS confirmation', () => {
  const healthy = data.find((record) => record.route === 'SAP' && record.status === 'HEALTHY');
  const events = healthy.events.map((event) => event.checkpointId === 'WMS' ? { ...event, eventStatus: 'RECOVERED' } : event);
  events.push({ ...events.at(-1), eventId: 'AUDIT-ONLY', eventType: 'SIMULATED_RECOVERY' });
  assert.equal(flow.checkpointEvents(events).length, 7);
  assert.deepEqual(diagnosis.calculateJourneyState(events, healthy), { rag: 'AMBER', status: 'RECOVERED' });
});

test('healthy and inconclusive journeys explicitly reject an unavailable recovery action', () => {
  for (const status of ['HEALTHY', 'INCONCLUSIVE']) {
    const journey = data.find((record) => record.status === status);
    assert.equal(diagnosis.recoveryTarget(journey), undefined);
    assert.throws(() => diagnosis.simulateRecovery(journey), /no recoverable checkpoint/);
  }
});

test('obsolete transport stages are absent from the new mock data', () => {
  assert.doesNotMatch(JSON.stringify(data), /SFTP|MESSAGE_QUEUE|FileShare/);
});

test('the initial render waits for persisted MongoDB journeys instead of showing an in-bundle fallback', () => {
  const html = renderToStaticMarkup(createElement(App));
  assert(html.includes('Loading ASN journeys from MongoDB'));
  assert.doesNotMatch(html, /SELECTED SUPPLIER ASN|class="lifecycle-stage /);
  assert.doesNotMatch(html, /SFTP|Message Queue|Five platform milestones/);
});
