import type { AsnJourney } from '../types/asn';
import {
  asnStatusLabels, checkpointEvent, checkpointEvents, checkpointLabel, journeyRoutes,
  journeyStatusLabels, routeLabels, sourceProviders, systemDetails,
} from './journey';

export const reportDefinitions = [
  { id: 'journeys', label: 'ASN journey summary', description: 'One row per ASN, including business fields, route, current owner, and diagnosis.' },
  { id: 'events', label: 'Checkpoint event detail', description: 'All checkpoint records and simulated recovery audit events, including message IDs, SAP IDoc, and timestamps.' },
] as const;
export type ReportKind = typeof reportDefinitions[number]['id'];
export interface ReportData {
  headers: string[];
  rows: (string | number)[][];
}

export interface VolumeBucket {
  key: string;
  label: string;
  total: number;
  received: number;
  failed: number;
}

interface CheckpointException {
  key: string;
  label: string;
  owner: string;
  failed: number;
  waiting: number;
  unknown: number;
  total: number;
}

function receiptConfirmed(journey: AsnJourney) {
  return Boolean(journey.receiptTimestamp) && checkpointEvent(journey, 'WMS')?.eventStatus === 'COMPLETE';
}

function hasFailure(journey: AsnJourney) {
  return checkpointEvents(journey.events).some((event) => event.eventStatus === 'FAILED');
}

function volume(records: AsnJourney[]) {
  return {
    total: records.length,
    received: records.filter(receiptConfirmed).length,
    failed: records.filter(hasFailure).length,
  };
}

export function summarizeJourneys(records: AsnJourney[]) {
  const totals = volume(records);
  const exceptions = new Map<string, CheckpointException>();
  for (const journey of records) {
    for (const event of checkpointEvents(journey.events)) {
      const kind = event.eventStatus === 'FAILED' ? 'failed' : event.eventStatus === 'UNKNOWN' ? 'unknown'
        : ['DELAYED', 'PENDING', 'AWAITING_CONFIRMATION'].includes(event.eventStatus) ||
          (event.checkpointId === 'WMS' && event.eventStatus === 'RECOVERED') ? 'waiting' : undefined;
      if (!kind) continue;
      const key = `${event.stageCode}:${event.checkpointId}`;
      const bucket = exceptions.get(key) ?? {
        key, label: checkpointLabel(event), owner: event.ownerTeam, failed: 0, waiting: 0, unknown: 0, total: 0,
      };
      bucket[kind]++;
      bucket.total++;
      exceptions.set(key, bucket);
    }
  }
  const middleware = (['MIDDLEWARE_INBOUND', 'MIDDLEWARE_OUTBOUND'] as const).map((id) => {
    const visits = records.flatMap((journey) => {
      const event = checkpointEvent(journey, id);
      return event ? [event] : [];
    });
    const durations = visits.flatMap((event) => {
      if (event.eventStatus !== 'COMPLETE' || !event.inTimestamp || !event.outTimestamp) return [];
      const duration = Date.parse(event.outTimestamp) - Date.parse(event.inTimestamp);
      if (!Number.isFinite(duration) || duration < 0) throw new Error(`Invalid Middleware timestamps for ${event.eventId}.`);
      return [duration / 60_000];
    });
    return {
      id, label: id === 'MIDDLEWARE_INBOUND' ? 'Middleware (source leg)' : 'Middleware (WMS leg)',
      samples: durations.length, excluded: visits.length - durations.length,
      averageMinutes: durations.length ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length : null,
    };
  });
  return {
    ...totals,
    open: totals.total - totals.received,
    receiptPercent: totals.total ? Math.round(totals.received / totals.total * 100) : 0,
    statuses: Object.entries(journeyStatusLabels).map(([key, label]) => ({
      key, label, count: records.filter((journey) => journey.status === key).length,
    })),
    providers: sourceProviders.map((source) => ({
      key: source, label: systemDetails[source].label, ...volume(records.filter((journey) => journey.sourceProvider === source)),
    })),
    routes: journeyRoutes.map((route) => ({
      key: route, label: routeLabels[route], ...volume(records.filter((journey) => journey.route === route)),
    })),
    exceptions: [...exceptions.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)),
    middleware,
  };
}

export function buildReport(records: AsnJourney[], kind: ReportKind): ReportData {
  if (kind === 'journeys') return {
    headers: [
      'ASN ID', 'Container ID', 'ASN status', 'Journey status', 'RAG', 'Source provider', 'Processing route',
      'Count of POs', 'Sum of Singles', 'Supplier', 'Sending site', 'Receiving site', 'Current checkpoint',
      'Current owner', 'PO numbers', 'URN ID', 'Article number', 'Trailer number',
      'Dispatch date/time (UTC)', 'Receipt date/time (UTC)', 'Diagnosis', 'Mock data',
    ],
    rows: records.map((journey) => {
      const current = checkpointEvent(journey, journey.currentCheckpoint);
      return [
        journey.asnId, journey.containerId, asnStatusLabels[journey.asnStatus], journeyStatusLabels[journey.status],
        journey.ragStatus, systemDetails[journey.sourceProvider].label, routeLabels[journey.route],
        journey.poCount, journey.sumOfSingles, journey.supplierName, journey.sendingSite, journey.receivingSite,
        current ? checkpointLabel(current) : 'Evidence review', journey.currentOwner, journey.poNumbers.join('; '),
        journey.urnId, journey.articleNumber, journey.trailerNumber, journey.dispatchTimestamp,
        journey.receiptTimestamp ?? '', journey.diagnosis, 'Yes',
      ];
    }),
  };
  return {
    headers: [
      'ASN ID', 'Container ID', 'Source provider', 'Processing route', 'Checkpoint', 'Sequence', 'Event type',
      'Event status', 'Recorded date/time (UTC)', 'Middleware in (UTC)', 'Middleware out (UTC)',
      'IBD date/time (UTC)', 'OBD date/time (UTC)', 'Message ID', 'SAP IDoc', 'GI transaction ID',
      'Source reference', 'Owner', 'Error code', 'Error message', 'Retry count', 'Mock data',
    ],
    rows: records.flatMap((journey) => journey.events.map((event) => [
      journey.asnId, journey.containerId, systemDetails[journey.sourceProvider].label, routeLabels[journey.route],
      checkpointLabel(event), event.stageSequence, event.eventType, event.eventStatus, event.eventTimestamp ?? '',
      event.inTimestamp ?? '', event.outTimestamp ?? '', event.ibdTimestamp ?? '', event.obdTimestamp ?? '',
      event.messageId ?? '', event.idocNumber ?? '', event.transactionId ?? '', event.sourceReference ?? '',
      event.ownerTeam, event.errorCode ?? '', event.errorMessage ?? '', event.retryCount, 'Yes',
    ])),
  };
}

export function reportCsv(report: ReportData) {
  if (report.rows.some((row) => row.length !== report.headers.length)) {
    throw new Error('Report rows do not match the CSV column definitions.');
  }
  const cell = (value: string | number) => {
    const text = String(value);
    // Spreadsheet applications can execute formula-prefixed text.
    const formulaCandidate = text.replaceAll('\u0000', '').trimStart();
    const safe = typeof value === 'string' && /^[=+\-@]/.test(formulaCandidate) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [report.headers, ...report.rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
