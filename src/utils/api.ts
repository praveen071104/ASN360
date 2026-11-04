import type { AsnJourney } from '../types/asn';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAsnJourney(value: unknown): value is AsnJourney {
  return isRecord(value)
    && typeof value.asnId === 'string'
    && typeof value.containerId === 'string'
    && Array.isArray(value.events)
    && (value.day === 'Today' || value.day === 'Yesterday' || value.day === '2 days ago')
    && value.isMock === true;
}

async function parseResponse<T>(response: Response, isExpected: (value: unknown) => value is T): Promise<T> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) throw new Error(`API request failed (${response.status}): ${text.slice(0, 200) || response.statusText}`);
    throw new Error('The API returned invalid JSON.');
  }

  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : undefined;
    throw new Error(message ?? `API request failed (${response.status}).`);
  }
  if (!isExpected(payload)) throw new Error('The API response did not match the expected ASN data shape.');
  return payload;
}

function isJourneyList(value: unknown): value is AsnJourney[] {
  return Array.isArray(value) && value.every(isAsnJourney);
}

export async function fetchJourneys(signal?: AbortSignal): Promise<AsnJourney[]> {
  const response = await fetch('/api/journeys', { signal });
  return parseResponse(response, isJourneyList);
}

export async function persistRecovery(asnId: string): Promise<AsnJourney> {
  const response = await fetch(`/api/journeys/${encodeURIComponent(asnId)}/recovery`, { method: 'POST' });
  return parseResponse(response, isAsnJourney);
}
