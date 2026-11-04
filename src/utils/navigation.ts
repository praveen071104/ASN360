export const workspacePages = [
  {
    id: 'dashboard', label: 'Dashboard', heading: 'ASN360 Control Tower', breadcrumb: 'ASN overview',
    overline: 'SUPPLIER ASN OVERVIEW',
    description: 'ediTrack or OpenText to WMS. SAP and GI routes with checkpoint-level traceability.',
  },
  {
    id: 'asn-queue', label: 'ASN Queue', heading: 'ASN Queue', breadcrumb: 'ASN queue',
    overline: 'JOURNEY WORKSPACE',
    description: 'Search and filter supplier ASNs, inspect checkpoint evidence, and simulate recovery.',
  },
  {
    id: 'analytics', label: 'Analytics', heading: 'Analytics', breadcrumb: 'Analytics',
    overline: 'OPERATIONAL INSIGHTS',
    description: 'Journey health, provider and route volumes, and checkpoint exceptions for the selected day.',
  },
  {
    id: 'reports', label: 'Reports', heading: 'Reports', breadcrumb: 'Reports',
    overline: 'DATA EXPORTS',
    description: 'Preview and download selected-day journey summaries or checkpoint event evidence as CSV.',
  },
  {
    id: 'admin', label: 'Admin', heading: 'Admin', breadcrumb: 'Admin',
    overline: 'DEMO CONFIGURATION',
    description: 'Read-only route definitions, system capabilities, and operational ownership for this prototype.',
  },
] as const;

export type WorkspacePage = typeof workspacePages[number]['id'];

export function pageFromHash(hash: string): WorkspacePage | undefined {
  const id = hash.replace(/^#\/?/, '');
  return id === '' ? 'dashboard' : workspacePages.find((page) => page.id === id)?.id;
}
