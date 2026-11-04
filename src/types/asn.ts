export type JourneyStatus = 'HEALTHY' | 'AT_RISK' | 'DELAYED' | 'RECOVERED' | 'INCONCLUSIVE';
export type RagStatus = 'GREEN' | 'AMBER' | 'RED' | 'GREY';
export type SourceProvider = 'EDITRACK' | 'OPEN_TEXT';
export type JourneyRoute = 'SAP' | 'GI';
export type StageCode = SourceProvider | 'MIDDLEWARE' | 'SAP_PI_PO' | 'SAP' | 'GLOBAL_INBOUND' | 'WMS';
export type CheckpointId =
  | 'SOURCE'
  | 'MIDDLEWARE_INBOUND'
  | 'SAP_PI_PO_INBOUND'
  | 'SAP'
  | 'GLOBAL_INBOUND'
  | 'SAP_PI_PO_OUTBOUND'
  | 'MIDDLEWARE_OUTBOUND'
  | 'WMS';
export type SupplierAsnStatus = 'CREATED' | 'DISPATCHED' | 'RECEIVED';
export type EventStatus =
  | 'COMPLETE'
  | 'FAILED'
  | 'PENDING'
  | 'DELAYED'
  | 'RECOVERED'
  | 'BLOCKED'
  | 'NOT_STARTED'
  | 'AWAITING_CONFIRMATION'
  | 'UNKNOWN';

export interface JourneyStage {
  id: CheckpointId;
  code: StageCode;
  label: string;
  sequence: number;
}

export interface SupplierAsnFields {
  containerId: string;
  asnId: string;
  asnStatus: SupplierAsnStatus;
  poCount: number;
  sumOfSingles: number;
}

export interface PlatformEvent {
  eventId: string;
  correlationId: string;
  checkpointId: CheckpointId;
  stageCode: StageCode;
  stageSequence: number;
  eventType: 'CHECKPOINT_STATUS' | 'SIMULATED_RECOVERY';
  eventLabel: string;
  eventStatus: EventStatus;
  eventTimestamp: string | null;
  inTimestamp?: string | null;
  outTimestamp?: string | null;
  ibdTimestamp: string | null;
  obdTimestamp: string | null;
  businessFields?: SupplierAsnFields;
  sourceReference?: string;
  messageId?: string;
  idocNumber?: string;
  transactionId?: string;
  errorCode?: string;
  errorMessage?: string;
  retryCount: number;
  ownerTeam: string;
  communicationRoute: string;
  evidenceFreshnessAt?: string;
  isMock: true;
}

export interface StatusHistory {
  id: string;
  timestamp: string;
  fromStatus: JourneyStatus;
  toStatus: JourneyStatus;
  system: StageCode | 'ASN360';
  checkpointId?: CheckpointId;
  reason: string;
  changedBy: string;
}

export interface AsnJourney extends SupplierAsnFields {
  day: 'Today' | 'Yesterday' | '2 days ago';
  correlationId: string;
  sourceProvider: SourceProvider;
  route: JourneyRoute;
  poNumbers: string[];
  urnId: string;
  articleNumber: string;
  trailerNumber: string;
  supplierName: string;
  sendingSite: string;
  receivingSite: string;
  shipmentType: string;
  shippedUrnCount: number;
  receivedUrnCount: number | null;
  dispatchTimestamp: string;
  receiptTimestamp?: string;
  status: JourneyStatus;
  ragStatus: RagStatus;
  currentCheckpoint: CheckpointId | 'UNKNOWN';
  ageMinutes: number;
  lastSuccessfulCheckpoint?: CheckpointId;
  firstFailureCheckpoint?: CheckpointId;
  currentOwner: string;
  communicationRoute: string;
  diagnosis: string;
  diagnosisConfidence: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendation: string;
  events: PlatformEvent[];
  statusHistory: StatusHistory[];
  isMock: true;
}
