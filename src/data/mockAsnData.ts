import type { AsnJourney, EventStatus, PlatformEvent, SourceProvider, SupplierAsnFields } from '../types/asn';
import { assessJourney } from '../utils/diagnosis';
import { getJourneyStages, systemDetails } from '../utils/journey';

type Scenario = {
  name: string;
  sourceProvider: SourceProvider;
  day: AsnJourney['day'];
  errorCode?: string;
  error?: string;
  retry?: number;
  quantityMismatch?: boolean;
} & (
  | { route: 'SAP'; statuses: [EventStatus, EventStatus, EventStatus, EventStatus, EventStatus, EventStatus, EventStatus] }
  | { route: 'GI'; statuses: [EventStatus, EventStatus, EventStatus, EventStatus, EventStatus] }
);

const scenarios: Scenario[] = [
  { name: 'Healthy ediTrack SAP journey', sourceProvider: 'EDITRACK', route: 'SAP', day: 'Today', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE'] },
  { name: 'Healthy OpenText GI journey', sourceProvider: 'OPEN_TEXT', route: 'GI', day: 'Today', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE'] },
  { name: 'Healthy ediTrack GI journey', sourceProvider: 'EDITRACK', route: 'GI', day: 'Today', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE'] },
  { name: 'Healthy OpenText SAP journey', sourceProvider: 'OPEN_TEXT', route: 'SAP', day: 'Today', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE'] },
  { name: 'ediTrack validation failure', sourceProvider: 'EDITRACK', route: 'SAP', day: 'Today', statuses: ['FAILED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED'], errorCode: 'EDI-VAL-004', error: 'Source validation rejected the ASN: a mandatory dispatch field is missing.' },
  { name: 'OpenText validation failure', sourceProvider: 'OPEN_TEXT', route: 'GI', day: 'Today', statuses: ['FAILED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED'], errorCode: 'OT-VAL-002', error: 'OpenText rejected the supplier document because its structure is invalid.' },
  { name: 'Source-leg Middleware failure', sourceProvider: 'OPEN_TEXT', route: 'SAP', day: 'Today', statuses: ['COMPLETE', 'FAILED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED'], errorCode: 'MW-IN-DELIVERY', error: 'Middleware received the message but delivery to SAP PI/PO failed.' },
  { name: 'Source-leg Middleware delay', sourceProvider: 'EDITRACK', route: 'GI', day: 'Today', statuses: ['COMPLETE', 'DELAYED', 'BLOCKED', 'BLOCKED', 'BLOCKED'], errorCode: 'MW-IN-OVERDUE', error: 'Middleware has an inbound timestamp, but no outbound confirmation to GI.' },
  { name: 'SAP PI/PO inbound mapping failure', sourceProvider: 'EDITRACK', route: 'SAP', day: 'Today', statuses: ['COMPLETE', 'COMPLETE', 'FAILED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED'], errorCode: 'PI-IN-MAP', error: 'The inbound interface mapping failed before the message reached SAP.' },
  { name: 'SAP IDoc processing failure', sourceProvider: 'OPEN_TEXT', route: 'SAP', day: 'Today', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'FAILED', 'BLOCKED', 'BLOCKED', 'BLOCKED'], errorCode: 'SAP-IDOC-51', error: 'SAP IDoc application processing failed; review the document in SAP.' },
  { name: 'SAP PI/PO outbound failure', sourceProvider: 'EDITRACK', route: 'SAP', day: 'Today', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'FAILED', 'BLOCKED', 'BLOCKED'], errorCode: 'PI-OUT-MAP', error: 'SAP processing completed, but the outbound PI/PO transformation failed.' },
  { name: 'WMS-leg Middleware failure', sourceProvider: 'OPEN_TEXT', route: 'SAP', day: 'Today', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'FAILED', 'BLOCKED'], errorCode: 'MW-OUT-DELIVERY', error: 'The WMS-bound Middleware message has no successful delivery acknowledgement.' },
  { name: 'GI site mapping failure', sourceProvider: 'EDITRACK', route: 'GI', day: 'Today', statuses: ['COMPLETE', 'COMPLETE', 'FAILED', 'BLOCKED', 'BLOCKED'], errorCode: 'GI-MAP-012', error: 'Receiving-site mapping for the destination is missing.' },
  { name: 'GI transformation failure', sourceProvider: 'OPEN_TEXT', route: 'GI', day: 'Today', statuses: ['COMPLETE', 'COMPLETE', 'FAILED', 'BLOCKED', 'BLOCKED'], errorCode: 'GI-XFORM-031', error: 'GI could not transform the inbound payload to the WMS schema.' },
  { name: 'WMS import failure', sourceProvider: 'EDITRACK', route: 'SAP', day: 'Today', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'FAILED'], errorCode: 'WMS-IMPORT-409', error: 'WMS rejected the import because the delivery reference already exists.' },
  { name: 'Awaiting WMS receipt', sourceProvider: 'OPEN_TEXT', route: 'GI', day: 'Today', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'AWAITING_CONFIRMATION'], errorCode: 'WMS-RECEIPT-PENDING', error: 'The import was accepted; warehouse receipt confirmation has not arrived.' },
  { name: 'URN quantity mismatch', sourceProvider: 'EDITRACK', route: 'GI', day: 'Today', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'FAILED'], errorCode: 'WMS-URN-QTY-02', error: 'Received URN quantity does not match the dispatched quantity.', quantityMismatch: true },
  { name: 'Recovered source-leg Middleware', sourceProvider: 'OPEN_TEXT', route: 'SAP', day: 'Today', statuses: ['COMPLETE', 'RECOVERED', 'AWAITING_CONFIRMATION', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED'], errorCode: 'MW-RETRY-OK', error: 'Middleware retry succeeded; SAP PI/PO confirmation is pending.', retry: 1 },
  { name: 'Recovered outbound SAP PI/PO', sourceProvider: 'EDITRACK', route: 'SAP', day: 'Yesterday', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'RECOVERED', 'AWAITING_CONFIRMATION', 'BLOCKED'], errorCode: 'PI-REPROCESS-OK', error: 'Outbound PI/PO reprocessing succeeded; Middleware confirmation is pending.', retry: 1 },
  { name: 'Recovered GI journey', sourceProvider: 'OPEN_TEXT', route: 'GI', day: 'Yesterday', statuses: ['COMPLETE', 'COMPLETE', 'RECOVERED', 'AWAITING_CONFIRMATION', 'BLOCKED'], errorCode: 'GI-REPROCESS-OK', error: 'GI validation was corrected; the WMS-leg Middleware confirmation is pending.', retry: 1 },
  { name: 'Inconclusive adjacent checkpoints', sourceProvider: 'OPEN_TEXT', route: 'SAP', day: 'Yesterday', statuses: ['COMPLETE', 'UNKNOWN', 'UNKNOWN', 'PENDING', 'BLOCKED', 'BLOCKED', 'BLOCKED'], errorCode: 'TRACE-GAP-01', error: 'Evidence is unavailable across Middleware and inbound SAP PI/PO.' },
  { name: 'Yesterday healthy GI ASN', sourceProvider: 'EDITRACK', route: 'GI', day: 'Yesterday', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE'] },
  { name: 'Two-day-old outbound PI/PO failure', sourceProvider: 'OPEN_TEXT', route: 'SAP', day: '2 days ago', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'FAILED', 'BLOCKED', 'BLOCKED'], errorCode: 'PI-OUT-DELIVERY', error: 'Outbound SAP PI/PO delivery failed after the retry limit.', retry: 5 },
  { name: 'Two-day-old healthy SAP ASN', sourceProvider: 'EDITRACK', route: 'SAP', day: '2 days ago', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE'] },
  { name: 'Two-day-old delayed receipt', sourceProvider: 'OPEN_TEXT', route: 'GI', day: '2 days ago', statuses: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'AWAITING_CONFIRMATION'], errorCode: 'WMS-RECEIPT-PENDING', error: 'WMS receipt confirmation is outstanding.' },
];

const suppliers = ['Northstar Foods Ltd', 'Cedar & Vale Home', 'Brightline Apparel', 'Evergreen Essentials', 'Harbour Supply Co'];
const sites = ['DC 6401', 'DC 6427', 'DC 6510', 'DC 6602', 'DC 6714'];
const seededAt = Date.now();

function buildEvents(
  index: number, scenario: Scenario, correlationId: string, fields: SupplierAsnFields,
  start: number, interval: number,
): PlatformEvent[] {
  return getJourneyStages(scenario.sourceProvider, scenario.route).map(({ id, code, label, sequence }, stageIndex) => {
    const eventStatus = scenario.statuses[stageIndex];
    const hasEvidence = !['BLOCKED', 'NOT_STARTED', 'UNKNOWN'].includes(eventStatus);
    const completed = eventStatus === 'COMPLETE' || eventStatus === 'RECOVERED';
    const at = (fraction: number) => new Date(start + (stageIndex + fraction) * interval).toISOString();
    const timestamp = hasEvidence ? at(completed ? 0.75 : 0.5) : null;
    const relevantError = stageIndex === scenario.statuses.findIndex((status) => status !== 'COMPLETE');
    const system = systemDetails[code];
    return {
      eventId: `EVT-${String(index + 1).padStart(3, '0')}-${sequence}`,
      correlationId,
      checkpointId: id,
      stageCode: code,
      stageSequence: sequence,
      eventType: 'CHECKPOINT_STATUS',
      eventLabel: eventStatus === 'BLOCKED' ? 'Blocked by upstream checkpoint' : eventStatus === 'UNKNOWN'
        ? 'Evidence unavailable' : `${label} ${eventStatus.toLowerCase().replaceAll('_', ' ')}`,
      eventStatus,
      eventTimestamp: timestamp,
      inTimestamp: code === 'MIDDLEWARE' ? hasEvidence ? at(0) : null : undefined,
      outTimestamp: code === 'MIDDLEWARE' ? completed ? at(0.75) : null : undefined,
      ibdTimestamp: hasEvidence ? at(0.25) : null,
      obdTimestamp: completed ? at(0.5) : null,
      businessFields: system.exposesBusinessFields && hasEvidence ? {
        ...fields,
        asnStatus: code === 'WMS' && eventStatus === 'COMPLETE' ? 'RECEIVED'
          : id === 'SOURCE' && eventStatus === 'FAILED' ? 'CREATED' : 'DISPATCHED',
      } : undefined,
      sourceReference: hasEvidence ? `REF-${index + 1}-${sequence}` : undefined,
      messageId: hasEvidence && (code === 'MIDDLEWARE' || code === 'SAP_PI_PO') ? `MSG-${index + 1001}-${sequence}` : undefined,
      idocNumber: hasEvidence && (code === 'SAP' || code === 'SAP_PI_PO')
        ? String(8100000 + index).padStart(16, '0') : undefined,
      transactionId: hasEvidence && code === 'GLOBAL_INBOUND' ? `GI-${String(index + 1).padStart(6, '0')}` : undefined,
      errorCode: relevantError ? scenario.errorCode : undefined,
      errorMessage: relevantError ? scenario.error : undefined,
      retryCount: relevantError ? scenario.retry ?? 0 : 0,
      ownerTeam: system.owner,
      communicationRoute: system.communicationRoute,
      evidenceFreshnessAt: timestamp ?? undefined,
      isMock: true,
    };
  });
}

export const mockAsnData: AsnJourney[] = scenarios.map((scenario, index) => {
  const correlationId = `ASN360-2026-${String(index + 1001).padStart(6, '0')}`;
  const daysAgo = scenario.day === 'Today' ? 0 : scenario.day === 'Yesterday' ? 1 : 2;
  const dayStart = new Date(seededAt);
  dayStart.setDate(dayStart.getDate() - daysAgo);
  dayStart.setHours(0, 0, 0, 0);
  const latest = daysAgo === 0 ? seededAt : new Date(dayStart).setHours(16, 30, 0, 0);
  const start = Math.max(dayStart.getTime(), latest - (45 + index * 9) * 60_000);
  const interval = Math.min(4 * 60_000, (latest - start) / (scenario.statuses.length + 1));
  const receiptConfirmed = scenario.statuses[scenario.statuses.length - 1] === 'COMPLETE';
  const poNumbers = Array.from({ length: 1 + index % 4 }, (_, poIndex) => `45${81234000 + index * 113 + poIndex}`);
  const fields: SupplierAsnFields = {
    containerId: `CONT-${String(7512000 + index * 13)}`,
    asnId: `ASN-${String(284100 + index * 7).padStart(8, '0')}`,
    asnStatus: receiptConfirmed ? 'RECEIVED' : scenario.statuses[0] === 'FAILED' ? 'CREATED' : 'DISPATCHED',
    poCount: poNumbers.length,
    sumOfSingles: 1200 + index * 48,
  };
  const events = buildEvents(index, scenario, correlationId, fields, start, interval);
  const assessment = assessJourney(events, scenario);
  const current = events.find((event) => event.checkpointId === assessment.currentCheckpoint);
  const wms = events.find((event) => event.checkpointId === 'WMS');
  const shippedUrnCount = 24 + index % 8;
  return {
    ...fields,
    ...assessment,
    day: scenario.day,
    correlationId,
    sourceProvider: scenario.sourceProvider,
    route: scenario.route,
    poNumbers,
    urnId: `URN-${String(7412000 + index * 19).padStart(9, '0')}`,
    articleNumber: `0${String(932610 + index * 37).padStart(7, '0')}`,
    trailerNumber: `TRL-${String(240 + index).padStart(5, '0')}`,
    supplierName: suppliers[index % suppliers.length],
    sendingSite: sites[(index + 2) % sites.length],
    receivingSite: sites[index % sites.length],
    shipmentType: index % 3 === 0 ? 'Ambient' : index % 3 === 1 ? 'Chilled' : 'General merchandise',
    shippedUrnCount,
    receivedUrnCount: scenario.quantityMismatch ? shippedUrnCount - 2 : receiptConfirmed ? shippedUrnCount : null,
    dispatchTimestamp: new Date(start).toISOString(),
    receiptTimestamp: receiptConfirmed ? wms?.eventTimestamp ?? undefined : undefined,
    ageMinutes: Math.floor((seededAt - start) / 60_000),
    events,
    statusHistory: [{
      id: `HIST-${index + 1}-1`,
      timestamp: current?.eventTimestamp ?? new Date(start).toISOString(),
      fromStatus: 'HEALTHY',
      toStatus: assessment.status,
      system: current?.stageCode ?? 'ASN360',
      checkpointId: current?.checkpointId,
      reason: `${scenario.name}. ${assessment.diagnosis}`,
      changedBy: 'Seeded demo rule',
    }],
    isMock: true,
  };
});
