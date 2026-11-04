import type { AsnJourney, EventStatus, JourneyStatus, PlatformEvent, RagStatus } from '../types/asn';
import { checkpointEvents, checkpointLabel, getJourneyStages, systemDetails } from './journey';

type JourneyContext = Pick<AsnJourney, 'sourceProvider' | 'route'>;

export const ragForEvent = (status: EventStatus): RagStatus => {
  if (status === 'COMPLETE' || status === 'RECOVERED') return 'GREEN';
  if (status === 'PENDING' || status === 'DELAYED' || status === 'AWAITING_CONFIRMATION') return 'AMBER';
  if (status === 'FAILED') return 'RED';
  return 'GREY';
};

function needsConfirmation(event: PlatformEvent) {
  return ['DELAYED', 'PENDING', 'AWAITING_CONFIRMATION'].includes(event.eventStatus) ||
    (event.checkpointId === 'WMS' && event.eventStatus === 'RECOVERED');
}

export function calculateJourneyState(events: PlatformEvent[], context: JourneyContext): { rag: RagStatus; status: JourneyStatus } {
  const ordered = checkpointEvents(events);
  if (!ordered.length) return { rag: 'GREY', status: 'INCONCLUSIVE' };
  if (ordered.some((event) => event.eventStatus === 'FAILED')) return { rag: 'RED', status: 'AT_RISK' };
  if (ordered.some((event) => event.eventStatus === 'UNKNOWN')) return { rag: 'GREY', status: 'INCONCLUSIVE' };
  const expected = getJourneyStages(context.sourceProvider, context.route);
  if (ordered.length !== expected.length || expected.some((stage, index) =>
    ordered[index].checkpointId !== stage.id || ordered[index].stageCode !== stage.code || ordered[index].stageSequence !== stage.sequence)) {
    return { rag: 'GREY', status: 'INCONCLUSIVE' };
  }
  const hasRecovered = events.some((event) => event.eventStatus === 'RECOVERED');
  if (ordered.some(needsConfirmation)) {
    return {
      rag: 'AMBER',
      status: hasRecovered ? 'RECOVERED' : ordered.some((event) => event.eventStatus === 'DELAYED' || event.eventStatus === 'AWAITING_CONFIRMATION') ? 'DELAYED' : 'AT_RISK',
    };
  }
  const receiptConfirmed = ordered.some((event) => event.checkpointId === 'WMS' && event.eventStatus === 'COMPLETE');
  if (ordered[0].checkpointId === 'SOURCE' && receiptConfirmed &&
    ordered.every((event) => event.eventStatus === 'COMPLETE' || event.eventStatus === 'RECOVERED')) {
    return { rag: 'GREEN', status: hasRecovered ? 'RECOVERED' : 'HEALTHY' };
  }
  return { rag: 'GREY', status: 'INCONCLUSIVE' };
}

export function diagnoseJourney(events: PlatformEvent[], context: JourneyContext) {
  const ordered = checkpointEvents(events);
  const failure = ordered.find((event) => event.eventStatus === 'FAILED');
  const missing = ordered.find((event) => event.eventStatus === 'UNKNOWN');
  const attention = ordered.find(needsConfirmation);
  const unfinished = ordered.find((event) => ['BLOCKED', 'NOT_STARTED'].includes(event.eventStatus));
  const current = failure ?? missing ?? attention ?? unfinished ?? ordered[ordered.length - 1];
  const lastSuccess = [...ordered].reverse().find((event) =>
    ['COMPLETE', 'RECOVERED'].includes(event.eventStatus) &&
    (!current || current.eventStatus === 'COMPLETE' || event.stageSequence < current.stageSequence));
  const issue = failure ?? (missing ? undefined : attention);
  const assignment = issue ? systemDetails[issue.stageCode] : undefined;
  const complete = calculateJourneyState(events, context).rag === 'GREEN';
  const diagnosis = failure
    ? `${checkpointLabel(failure)}: ${failure.errorMessage ?? 'The platform reported a confirmed failure.'}`
    : missing
      ? `Evidence is unavailable at ${checkpointLabel(missing)}; the journey state cannot be confirmed.`
      : attention
        ? `${checkpointLabel(attention)} is awaiting confirmation.`
        : complete
          ? 'All route checkpoints completed and WMS receipt is confirmed.'
          : 'Checkpoint evidence is incomplete; WMS receipt cannot be confirmed.';
  return {
    failure, lastSuccess, attention, current,
    owner: assignment?.owner ?? 'ASN360 Operations',
    route: assignment?.communicationRoute ?? 'ASN360 operations review',
    diagnosis,
    recommendation: failure
      ? `Review ${failure.errorCode ?? 'the failed event'} at ${checkpointLabel(failure)} with ${assignment?.owner ?? 'the owning team'}. Trace by message ID or SAP IDoc where available, then reprocess after correction.`
      : missing || !current
        ? 'Request checkpoint trace evidence before assigning a cause or confirming receipt.'
        : attention
          ? `Check ${checkpointLabel(attention)} for processing confirmation. Do not close the journey until WMS receipt is confirmed.`
          : complete
            ? 'No action required. Continue monitoring until the receipt is archived.'
            : 'Request the missing checkpoint evidence and WMS receipt confirmation.',
  };
}

export function assessJourney(events: PlatformEvent[], context: JourneyContext): Pick<AsnJourney,
  'status' | 'ragStatus' | 'currentCheckpoint' | 'lastSuccessfulCheckpoint' | 'firstFailureCheckpoint' |
  'currentOwner' | 'communicationRoute' | 'diagnosis' | 'diagnosisConfidence' | 'severity' | 'recommendation'
> {
  const state = calculateJourneyState(events, context);
  const diagnosis = diagnoseJourney(events, context);
  return {
    status: state.status,
    ragStatus: state.rag,
    currentCheckpoint: diagnosis.current?.checkpointId ?? 'UNKNOWN',
    lastSuccessfulCheckpoint: diagnosis.lastSuccess?.checkpointId,
    firstFailureCheckpoint: diagnosis.failure?.checkpointId,
    currentOwner: diagnosis.owner,
    communicationRoute: diagnosis.route,
    diagnosis: diagnosis.diagnosis,
    diagnosisConfidence: diagnosis.failure ? 94 : state.status === 'INCONCLUSIVE' ? 38 : diagnosis.attention ? 86 : 99,
    severity: diagnosis.failure ? (diagnosis.failure.checkpointId === 'SOURCE' ? 'HIGH' : 'CRITICAL') : state.rag === 'GREEN' ? 'LOW' : 'MEDIUM',
    recommendation: diagnosis.recommendation,
  };
}

export function recoveryTarget(journey: AsnJourney) {
  if (journey.status !== 'AT_RISK' && journey.status !== 'DELAYED') return undefined;
  const ordered = checkpointEvents(journey.events);
  return ordered.find((event) => event.eventStatus === 'FAILED' || event.eventStatus === 'DELAYED') ??
    ordered.find(needsConfirmation);
}

export function simulateRecovery(journey: AsnJourney, now = new Date().toISOString()): AsnJourney {
  const target = recoveryTarget(journey);
  if (!target) throw new Error('This journey has no recoverable checkpoint.');
  const ordered = checkpointEvents(journey.events);
  const next = ordered[ordered.findIndex((event) => event.checkpointId === target.checkpointId) + 1];
  const updatedEvents: PlatformEvent[] = journey.events.map((event) => {
    if (event.eventType !== 'CHECKPOINT_STATUS') return event;
    if (event.checkpointId === target.checkpointId) return {
      ...event,
      eventStatus: event.checkpointId === 'WMS' ? 'AWAITING_CONFIRMATION' : 'RECOVERED',
      eventLabel: `${checkpointLabel(event)} retry simulated; ${event.checkpointId === 'WMS' ? 'receipt confirmation pending' : 'downstream confirmation pending'}`,
      eventTimestamp: now,
      outTimestamp: event.stageCode === 'MIDDLEWARE' && event.inTimestamp ? now : event.outTimestamp,
      errorCode: undefined,
      errorMessage: undefined,
      retryCount: event.retryCount + 1,
      evidenceFreshnessAt: now,
    };
    if (event.checkpointId === next?.checkpointId && ['BLOCKED', 'NOT_STARTED'].includes(event.eventStatus)) {
      return { ...event, eventStatus: 'AWAITING_CONFIRMATION', eventLabel: 'Awaiting platform confirmation after simulated recovery' };
    }
    return event;
  });
  const recoveryEvent: PlatformEvent = {
    eventId: `SIM-${journey.asnId}-${journey.statusHistory.length}`,
    correlationId: journey.correlationId,
    checkpointId: target.checkpointId,
    stageCode: target.stageCode,
    stageSequence: target.stageSequence,
    eventType: 'SIMULATED_RECOVERY',
    eventLabel: `Recovery simulated for ${checkpointLabel(target)}; no downstream or receipt evidence has been generated`,
    eventStatus: 'RECOVERED',
    eventTimestamp: now,
    ibdTimestamp: null,
    obdTimestamp: null,
    sourceReference: `SIM-REF-${journey.asnId.slice(-6)}-${journey.statusHistory.length}`,
    retryCount: target.retryCount + 1,
    ownerTeam: target.ownerTeam,
    communicationRoute: target.communicationRoute,
    evidenceFreshnessAt: now,
    isMock: true,
  };
  const events = [...updatedEvents, recoveryEvent];
  const assessment = assessJourney(events, journey);
  return {
    ...journey,
    ...assessment,
    diagnosis: `Recovery simulated for ${checkpointLabel(target)}. ${assessment.diagnosis}`,
    events,
    statusHistory: [...journey.statusHistory, {
      id: `SIM-HIST-${journey.asnId}-${journey.statusHistory.length}`,
      timestamp: now,
      fromStatus: journey.status,
      toStatus: assessment.status,
      system: target.stageCode,
      checkpointId: target.checkpointId,
      reason: 'Retry simulated in browser memory; downstream processing and WMS receipt still require confirmation.',
      changedBy: 'Demo user',
    }],
  };
}

export function eventRag(status: EventStatus): RagStatus {
  return ragForEvent(status);
}
