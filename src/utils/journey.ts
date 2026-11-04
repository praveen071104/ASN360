import type {
  AsnJourney, CheckpointId, JourneyRoute, JourneyStage, JourneyStatus, PlatformEvent, RagStatus, SourceProvider, StageCode,
} from '../types/asn';

export const sourceProviders: SourceProvider[] = ['EDITRACK', 'OPEN_TEXT'];
export const journeyRoutes: JourneyRoute[] = ['SAP', 'GI'];
export const routeLabels: Record<JourneyRoute, string> = { SAP: 'SAP route', GI: 'GI route' };
export const asnStatusLabels = { CREATED: 'Created', DISPATCHED: 'Dispatched', RECEIVED: 'Received' };
export const journeyStatusLabels: Record<JourneyStatus, string> = {
  HEALTHY: 'Healthy', AT_RISK: 'At risk', DELAYED: 'Delayed', RECOVERED: 'Recovered', INCONCLUSIVE: 'Inconclusive',
};
export const ragLabels: Record<RagStatus, string> = { GREEN: 'Healthy', AMBER: 'Attention', RED: 'Failed', GREY: 'Inconclusive' };

export const systemDetails: Record<StageCode, {
  label: string;
  owner: string;
  communicationRoute: string;
  exposesBusinessFields: boolean;
}> = {
  EDITRACK: { label: 'ediTrack', owner: 'EDI Operations', communicationRoute: 'EDI support > ediTrack', exposesBusinessFields: true },
  OPEN_TEXT: { label: 'OpenText', owner: 'OpenText Support', communicationRoute: 'EDI support > OpenText', exposesBusinessFields: true },
  MIDDLEWARE: { label: 'Middleware', owner: 'Middleware Operations', communicationRoute: 'Integration support > Middleware', exposesBusinessFields: false },
  SAP_PI_PO: { label: 'SAP PI/PO', owner: 'SAP Integration Support', communicationRoute: 'SAP integration > PI/PO support', exposesBusinessFields: false },
  SAP: { label: 'SAP B/M', owner: 'SAP Application Support', communicationRoute: 'SAP applications > IDoc processing', exposesBusinessFields: true },
  GLOBAL_INBOUND: { label: 'GI', owner: 'Global Inbound Support', communicationRoute: 'Global Inbound L2 > validation', exposesBusinessFields: true },
  WMS: { label: 'WMS', owner: 'WMS Operations', communicationRoute: 'Warehouse systems > WMS support', exposesBusinessFields: true },
};

const checkpoints: Record<Exclude<CheckpointId, 'SOURCE'>, { code: StageCode; label: string }> = {
  MIDDLEWARE_INBOUND: { code: 'MIDDLEWARE', label: 'Middleware (source leg)' },
  SAP_PI_PO_INBOUND: { code: 'SAP_PI_PO', label: 'SAP PI/PO (to SAP)' },
  SAP: { code: 'SAP', label: 'SAP B/M' },
  GLOBAL_INBOUND: { code: 'GLOBAL_INBOUND', label: 'GI' },
  SAP_PI_PO_OUTBOUND: { code: 'SAP_PI_PO', label: 'SAP PI/PO (from SAP)' },
  MIDDLEWARE_OUTBOUND: { code: 'MIDDLEWARE', label: 'Middleware (WMS leg)' },
  WMS: { code: 'WMS', label: 'WMS' },
};

const routeCheckpoints: Record<JourneyRoute, CheckpointId[]> = {
  SAP: ['SOURCE', 'MIDDLEWARE_INBOUND', 'SAP_PI_PO_INBOUND', 'SAP', 'SAP_PI_PO_OUTBOUND', 'MIDDLEWARE_OUTBOUND', 'WMS'],
  GI: ['SOURCE', 'MIDDLEWARE_INBOUND', 'GLOBAL_INBOUND', 'MIDDLEWARE_OUTBOUND', 'WMS'],
};

export function checkpointLabel(event: Pick<PlatformEvent, 'checkpointId' | 'stageCode'>) {
  return event.checkpointId === 'SOURCE' ? systemDetails[event.stageCode].label : checkpoints[event.checkpointId].label;
}

export function getJourneyStages(sourceProvider: SourceProvider, route: JourneyRoute): JourneyStage[] {
  return routeCheckpoints[route].map((id, index) => {
    const code = id === 'SOURCE' ? sourceProvider : checkpoints[id].code;
    return { id, code, label: checkpointLabel({ checkpointId: id, stageCode: code }), sequence: index + 1 };
  });
}

export function checkpointEvents(events: PlatformEvent[]) {
  return events.filter((event) => event.eventType === 'CHECKPOINT_STATUS')
    .sort((a, b) => a.stageSequence - b.stageSequence);
}

export function checkpointEvent(journey: Pick<AsnJourney, 'events'>, id: CheckpointId | 'UNKNOWN') {
  return journey.events.find((event) => event.eventType === 'CHECKPOINT_STATUS' && event.checkpointId === id);
}

export function matchesJourneyQuery(journey: AsnJourney, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const values = [
    journey.asnId, journey.containerId, ...journey.poNumbers, journey.urnId, journey.articleNumber,
    journey.correlationId, journey.supplierName, journey.sendingSite, journey.receivingSite, journey.trailerNumber,
    systemDetails[journey.sourceProvider].label, routeLabels[journey.route],
    ...journey.events.flatMap((event) => [
      event.sourceReference, event.messageId, event.idocNumber, event.transactionId, event.errorCode,
    ]),
  ];
  return values.some((value) => value?.toLowerCase().includes(needle));
}
