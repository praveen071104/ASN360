import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertCircle, AlertTriangle, Archive, ArrowDownUp, ArrowRight, Bell,
  Check, CheckCircle2, ChevronDown, Circle, Clock3, FileText, Filter, HelpCircle,
  LayoutDashboard, Menu, PackageCheck, RefreshCw, Search, ShieldCheck, Truck,
  Warehouse, X, XCircle, type LucideIcon,
} from 'lucide-react';
import { AdminPage, AnalyticsPage, ReportsPage } from './components/WorkspacePages';
import { eventRag, recoveryTarget } from './utils/diagnosis';
import { fetchJourneys, persistRecovery } from './utils/api';
import {
  asnStatusLabels, checkpointEvent, checkpointEvents, checkpointLabel, getJourneyStages,
  journeyRoutes, journeyStatusLabels as statusLabels, matchesJourneyQuery, ragLabels, routeLabels, sourceProviders, systemDetails,
} from './utils/journey';
import { pageFromHash, workspacePages, type WorkspacePage } from './utils/navigation';
import type { AsnJourney, EventStatus, JourneyStatus, PlatformEvent, RagStatus, SupplierAsnFields } from './types/asn';

type DetailTab = 'Event timeline' | 'System field coverage' | 'Status history' | 'Related identifiers' | 'Raw mock event data';
type QuickFilter = 'All' | 'At risk' | 'Delayed' | 'Healthy' | 'Recovered' | 'Inconclusive';
type ToastMessage = { message: string; type: 'success' | 'error' };

const summaryCards: { label: string; status?: JourneyStatus; icon: LucideIcon; sublabel: string }[] = [
  { label: 'Total ASNs', icon: PackageCheck, sublabel: 'Across selected day' },
  { label: 'Healthy', status: 'HEALTHY', icon: ShieldCheck, sublabel: 'Journey complete' },
  { label: 'At risk', status: 'AT_RISK', icon: AlertCircle, sublabel: 'Confirmed failures' },
  { label: 'Delayed', status: 'DELAYED', icon: Clock3, sublabel: 'Awaiting a milestone' },
  { label: 'Recovered', status: 'RECOVERED', icon: RefreshCw, sublabel: 'Recovery in progress' },
  { label: 'Inconclusive', status: 'INCONCLUSIVE', icon: HelpCircle, sublabel: 'Evidence unavailable' },
];
const detailTabs: DetailTab[] = ['Event timeline', 'System field coverage', 'Status history', 'Related identifiers', 'Raw mock event data'];

function eventIdentifiers(event: PlatformEvent): [string, string | undefined][] {
  const identifiers: [string, string | undefined][] = [];
  if (event.stageCode === 'MIDDLEWARE' || event.stageCode === 'SAP_PI_PO') identifiers.push(['Message ID', event.messageId]);
  if (event.stageCode === 'SAP' || event.idocNumber) identifiers.push(['SAP IDoc', event.idocNumber]);
  if (event.stageCode === 'GLOBAL_INBOUND') identifiers.push(['GI transaction ID', event.transactionId]);
  identifiers.push(['Source reference', event.sourceReference]);
  return identifiers;
}

function RagBadge({ rag }: { rag: RagStatus }) {
  return <span className={`rag-badge rag-${rag.toLowerCase()}`}><span className="rag-dot" />{ragLabels[rag]}</span>;
}

function JourneyBadge({ status }: { status: JourneyStatus }) {
  return <span className={`journey-badge journey-${status.toLowerCase()}`}>{statusLabels[status]}</span>;
}

function EventIcon({ status }: { status: EventStatus }) {
  if (status === 'COMPLETE') return <CheckCircle2 size={19} />;
  if (status === 'RECOVERED') return <RefreshCw size={18} />;
  if (status === 'FAILED') return <XCircle size={19} />;
  if (status === 'DELAYED' || status === 'PENDING' || status === 'AWAITING_CONFIRMATION') return <AlertTriangle size={19} />;
  if (status === 'UNKNOWN') return <HelpCircle size={18} />;
  return <Circle size={17} />;
}

function formatTime(value?: string | null) {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short' }).format(new Date(value));
}

function formatAge(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  const days = Math.floor(minutes / 1440);
  return `${days}d ${Math.floor((minutes % 1440) / 60)}h`;
}

function Sidebar({ page, queueCount, onNavigate }: { page: WorkspacePage | undefined; queueCount: number; onNavigate: () => void }) {
  const icons: Record<WorkspacePage, LucideIcon> = {
    dashboard: LayoutDashboard, 'asn-queue': Archive, analytics: Activity, reports: FileText, admin: Warehouse,
  };
  return <aside className="sidebar" id="main-sidebar">
    <div className="brand">
      <div className="ms-mark" aria-label="M and S">M&amp;S</div>
      <div><strong>ASN360</strong><span>CONTROL TOWER</span></div>
    </div>
    <div className="workspace-caption">WORKSPACE</div>
    <nav aria-label="Main navigation">
      {workspacePages.map(({ id, label }) => {
        const Icon = icons[id];
        return <a className={`nav-item ${page === id ? 'active' : ''}`} key={id} href={`#${id}`} aria-current={page === id ? 'page' : undefined} onClick={onNavigate}>
          <Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>{id === 'asn-queue' && <span className="nav-count" title="ASNs for the selected day">{queueCount}</span>}
        </a>;
      })}
    </nav>
    <div className="sidebar-bottom">
      <div className="demo-icon"><ShieldCheck size={17} /></div>
      <div><strong>Demo environment</strong><span>Mock data stored in MongoDB</span><span>No live source systems</span></div>
      <span className="online-dot" />
    </div>
  </aside>;
}

function Header({ day, setDay, onMenu, menuOpen, breadcrumb }: {
  day: AsnJourney['day'];
  setDay: (day: AsnJourney['day']) => void;
  onMenu: () => void;
  menuOpen: boolean;
  breadcrumb: string;
}) {
  return <header className="topbar">
    <button className="mobile-menu icon-button" type="button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="main-sidebar" onClick={onMenu}><Menu size={19} /></button>
    <div className="breadcrumbs"><span>Control tower</span><span className="crumb-sep">/</span><strong>{breadcrumb}</strong></div>
    <div className="top-actions">
      <div className="demo-label"><span />Demo environment <i>|</i> Seeded mock data <i>|</i> No live system connections</div>
      <label className="day-select"><span className="sr-only">Select day</span>
        <select value={day} onChange={(event) => setDay(event.target.value as AsnJourney['day'])}>
          <option>Today</option><option>Yesterday</option><option>2 days ago</option>
        </select><ChevronDown size={15} />
      </label>
      <button className="icon-button notification" type="button" aria-label="Notifications"><Bell size={18} /><span /></button>
      <div className="avatar" aria-label="Demo user">JD</div>
    </div>
  </header>;
}

function SummaryGrid({ records }: { records: AsnJourney[] }) {
  return <section className="summary-grid" aria-label="ASN summary">
    {summaryCards.map(({ label, status, icon: Icon, sublabel }) => {
      const count = status ? records.filter((record) => record.status === status).length : records.length;
      const percent = records.length ? Math.round(count / records.length * 100) : 0;
      const rag = status === 'HEALTHY' ? 'GREEN' : status === 'AT_RISK' ? 'RED' : status === 'DELAYED' || status === 'RECOVERED' ? 'AMBER' : status === 'INCONCLUSIVE' ? 'GREY' : undefined;
      return <article className={`summary-card ${rag ? `summary-${rag.toLowerCase()}` : ''}`} key={label}>
        <div className="summary-top"><span>{label}</span><span className="summary-icon"><Icon size={17} /></span></div>
        <div className="summary-value">{count}<span>{label === 'Total ASNs' ? ' ASNs' : ''}</span></div>
        <div className="summary-foot"><span>{sublabel}</span>{status && <strong>{percent}%</strong>}</div>
      </article>;
    })}
  </section>;
}

function Queue({ records, selectedId, onSelect }: { records: AsnJourney[]; selectedId: string; onSelect: (record: AsnJourney) => void }) {
  const [query, setQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('All');
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [siteFilter, setSiteFilter] = useState('All sites');
  const [typeFilter, setTypeFilter] = useState('All types');
  const [ragFilter, setRagFilter] = useState('All RAG');
  const [sourceFilter, setSourceFilter] = useState('All providers');
  const [routeFilter, setRouteFilter] = useState('All routes');
  const siteOptions = [...new Set(records.flatMap((record) => [record.sendingSite, record.receivingSite]))];
  const filtered = useMemo(() => {
    const priority: Record<RagStatus, number> = { RED: 0, AMBER: 1, GREY: 2, GREEN: 3 };
    return records.filter((record) => {
      const matchesQuick = quickFilter === 'All' || record.status === quickFilter.toUpperCase().replaceAll(' ', '_');
      return matchesJourneyQuery(record, query) && matchesQuick &&
        (statusFilter === 'All statuses' || record.status === statusFilter) &&
        (siteFilter === 'All sites' || record.sendingSite === siteFilter || record.receivingSite === siteFilter) &&
        (typeFilter === 'All types' || record.shipmentType === typeFilter) &&
        (ragFilter === 'All RAG' || record.ragStatus === ragFilter) &&
        (sourceFilter === 'All providers' || record.sourceProvider === sourceFilter) &&
        (routeFilter === 'All routes' || record.route === routeFilter);
    }).sort((a, b) => priority[a.ragStatus] - priority[b.ragStatus] || b.ageMinutes - a.ageMinutes);
  }, [records, query, quickFilter, statusFilter, siteFilter, typeFilter, ragFilter, sourceFilter, routeFilter]);
  const tabs: QuickFilter[] = ['All', 'At risk', 'Delayed', 'Healthy', 'Recovered', 'Inconclusive'];
  return <section className="panel queue-panel">
    <div className="panel-heading queue-heading">
      <div><span className="eyebrow">MONITORING</span><h2>ASN queue <span className="total-pill">{filtered.length}</span></h2></div>
      <button className="small-icon-button" type="button" aria-label="Sort by operational priority"><ArrowDownUp size={16} /></button>
    </div>
    <div className="queue-search"><Search size={16} /><input aria-label="Search ASN queue" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ASN, container, message ID, IDoc, PO…" />{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={15} /></button>}<kbd>/</kbd></div>
    <div className="filter-row route-filters" aria-label="Source and route filters">
      <span className="filter-icon"><ArrowRight size={14} /></span>
      <select aria-label="Filter by source provider" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option>All providers</option>{sourceProviders.map((source) => <option key={source} value={source}>{systemDetails[source].label}</option>)}</select>
      <select aria-label="Filter by processing route" value={routeFilter} onChange={(event) => setRouteFilter(event.target.value)}><option>All routes</option>{journeyRoutes.map((route) => <option key={route} value={route}>{routeLabels[route]}</option>)}</select>
    </div>
    <div className="filter-row" aria-label="Queue filters">
      <span className="filter-icon"><Filter size={14} /></span>
      <select aria-label="Filter by site" value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option>All sites</option>{siteOptions.map((site) => <option key={site}>{site}</option>)}</select>
      <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option>{['HEALTHY', 'AT_RISK', 'DELAYED', 'RECOVERED', 'INCONCLUSIVE'].map((status) => <option key={status} value={status}>{statusLabels[status as JourneyStatus]}</option>)}</select>
      <select aria-label="Filter by shipment type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>All types</option>{[...new Set(records.map((record) => record.shipmentType))].map((type) => <option key={type}>{type}</option>)}</select>
      <select aria-label="Filter by RAG" value={ragFilter} onChange={(event) => setRagFilter(event.target.value)}><option>All RAG</option>{['RED', 'AMBER', 'GREY', 'GREEN'].map((rag) => <option key={rag} value={rag}>{ragLabels[rag as RagStatus]}</option>)}</select>
    </div>
    <div className="quick-tabs" role="tablist" aria-label="Quick status filters">
      {tabs.map((tab) => <button role="tab" aria-selected={quickFilter === tab} className={quickFilter === tab ? 'selected' : ''} type="button" key={tab} onClick={() => setQuickFilter(tab)}>{tab}</button>)}
    </div>
    <div className="queue-table-wrap">
      <table className="queue-table">
        <thead><tr><th>RAG</th><th>ASN / container</th><th>Supplier · route</th><th>Current checkpoint</th><th>Status</th><th>Age</th></tr></thead>
        <tbody>{filtered.map((record) => {
          const activeEvent = checkpointEvent(record, record.currentCheckpoint);
          return <tr key={record.asnId} onClick={() => onSelect(record)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(record); }} tabIndex={0} aria-selected={record.asnId === selectedId} className={record.asnId === selectedId ? 'row-selected' : ''}>
            <td><span className="table-rag-label"><span className={`table-rag rag-${record.ragStatus.toLowerCase()}`} />{ragLabels[record.ragStatus]}</span></td>
            <td><strong>{record.asnId}</strong><span className="table-sub">{record.containerId}</span><span className="table-sub">{systemDetails[record.sourceProvider].label} · {routeLabels[record.route]}</span></td>
            <td><span className="supplier-name">{record.supplierName}</span><span className="table-sub">{record.sendingSite} <ArrowRight size={10} /> {record.receivingSite}</span></td>
            <td><span className="stage-cell" title={activeEvent ? checkpointLabel(activeEvent) : 'Evidence review'}>{activeEvent ? checkpointLabel(activeEvent) : 'Evidence review'}</span><span className="table-sub">{activeEvent?.eventLabel ?? 'No current milestone'}</span></td>
            <td><JourneyBadge status={record.status} /></td>
            <td className="age-cell">{formatAge(record.ageMinutes)}</td>
          </tr>;
        })}{filtered.length === 0 && <tr><td colSpan={6} className="empty-state"><Search size={20} /><strong>No ASN journeys match</strong><span>Try changing the search term or filters.</span></td></tr>}</tbody>
      </table>
    </div>
    <div className="queue-footer"><span>Showing <strong>{filtered.length}</strong> of {records.length} journeys</span><span><span className="sort-dot" />Sorted by operational priority</span></div>
  </section>;
}

function FactsGrid({ facts }: { facts: [string, string][] }) {
  return <div className="facts-grid">{facts.map(([label, value]) => <div className="fact" key={label}><span>{label}</span><strong title={value}>{value}</strong></div>)}</div>;
}

function ShipmentFacts({ journey }: { journey: AsnJourney }) {
  const current = checkpointEvent(journey, journey.currentCheckpoint);
  const primary: [string, string][] = [
    ['Container ID', journey.containerId], ['ASN ID', journey.asnId], ['ASN status', asnStatusLabels[journey.asnStatus]],
    ['Count of POs', String(journey.poCount)], ['Sum of Singles', journey.sumOfSingles.toLocaleString('en-GB')],
    ['Source provider', systemDetails[journey.sourceProvider].label], ['Processing route', routeLabels[journey.route]], ['Supplier', journey.supplierName],
  ];
  const secondary: [string, string][] = [
    ['PO numbers', journey.poNumbers.join(', ')], ['URN ID', journey.urnId], ['Article number', journey.articleNumber],
    ['Correlation ID', journey.correlationId], ['Trailer number', journey.trailerNumber], ['Supplier', journey.supplierName],
    ['Sending site', journey.sendingSite], ['Receiving site', journey.receivingSite], ['Shipment type', journey.shipmentType],
    ['URNs shipped', String(journey.shippedUrnCount)], ['URNs received', journey.receivedUrnCount === null ? 'Awaiting confirmation' : String(journey.receivedUrnCount)],
    ['Current checkpoint', current ? checkpointLabel(current) : 'Evidence review'], ['Current owner', journey.currentOwner], ['Journey age', formatAge(journey.ageMinutes)],
    ['Dispatch date/time', formatTime(journey.dispatchTimestamp)], ['Receipt date/time', formatTime(journey.receiptTimestamp)],
  ];
  return <><FactsGrid facts={primary} /><details className="secondary-facts"><summary>Shipment &amp; operational details · PO, URN, article, trailer</summary><FactsGrid facts={secondary} /></details></>;
}

function RouteOverview({ journey }: { journey: AsnJourney }) {
  return <section className="route-overview" aria-label="Selected ASN route">
    <div className="route-caption"><strong>{routeLabels[journey.route]}</strong><span>Selected from this ASN’s data · source provider is independent of route</span></div>
    <ol className="route-path">{getJourneyStages(journey.sourceProvider, journey.route).map((stage, index) =>
      <li key={stage.id}>{index > 0 && <ArrowRight size={12} aria-hidden="true" />}<span>{systemDetails[stage.code].label}</span></li>,
    )}</ol>
  </section>;
}

function Lifecycle({ journey }: { journey: AsnJourney }) {
  const stages = getJourneyStages(journey.sourceProvider, journey.route);
  return <section className="lifecycle">
    <div className="section-title"><div><h3>Journey lifecycle</h3><span>{stages.length} route checkpoints · each Middleware / PI/PO visit is tracked separately</span></div><span className="journey-range"><span className="live-pulse" />{journey.day}</span></div>
    <div className="lifecycle-scroll"><div className={`lifecycle-track route-${journey.route.toLowerCase()}`}>{stages.map(({ id, code, label }, index) => {
      const event = checkpointEvent(journey, id);
      const status = event?.eventStatus ?? 'UNKNOWN';
      const rag = eventRag(status);
      const reference = event ? eventIdentifiers(event)[0] : undefined;
      return <article className={`lifecycle-stage event-${status.toLowerCase()}`} key={id} aria-label={label} data-checkpoint={id}>
        <div className="stage-track"><div className={`stage-marker rag-${rag.toLowerCase()}`}><EventIcon status={status} /></div>{index < stages.length - 1 && <div className={`stage-connector ${status === 'COMPLETE' || status === 'RECOVERED' ? 'connector-done' : ''}`} />}</div>
        <div className="stage-content">
          <span className="checkpoint-order">CHECKPOINT {index + 1}</span>
          <div className="stage-name">{label}</div><span className={`event-chip rag-${rag.toLowerCase()}`} title={status.replaceAll('_', ' ')}>{status.replaceAll('_', ' ')}</span>
          <div className="stage-time">{formatTime(event?.eventTimestamp)}</div>
          {code === 'MIDDLEWARE' && <dl className="checkpoint-times"><div><dt>In date/time</dt><dd>{formatTime(event?.inTimestamp)}</dd></div><div><dt>Out date/time</dt><dd>{formatTime(event?.outTimestamp)}</dd></div></dl>}
          <div className="stage-label">{event?.eventLabel ?? 'Checkpoint evidence unavailable'}</div>
          <div className="stage-evidence">{event?.errorMessage ?? (status === 'BLOCKED' ? 'Waiting on upstream checkpoint' : !systemDetails[code].exposesBusinessFields ? 'Business fields are not exposed here; trace by technical ID.' : 'Business fields can be tracked at this system.')}</div>
          <div className="stage-reference"><span>{reference?.[0] ?? 'Platform reference'}</span><code title={reference?.[1]}>{reference?.[1] ?? 'Not recorded'}</code></div>
        </div>
      </article>;
    })}</div></div>
  </section>;
}

function DiagnosisPanel({ journey }: { journey: AsnJourney }) {
  const severity = journey.severity.toLowerCase();
  const failedEvent = journey.firstFailureCheckpoint ? checkpointEvent(journey, journey.firstFailureCheckpoint) : undefined;
  const successfulEvent = journey.lastSuccessfulCheckpoint ? checkpointEvent(journey, journey.lastSuccessfulCheckpoint) : undefined;
  const firstFailure = failedEvent ? checkpointLabel(failedEvent) : 'None identified';
  const lastSuccess = successfulEvent ? checkpointLabel(successfulEvent) : 'None confirmed';
  const freshest = journey.events.map((event) => event.evidenceFreshnessAt).filter((value): value is string => value !== undefined).sort().pop();
  return <section className={`diagnosis-panel diagnosis-${journey.ragStatus.toLowerCase()}`}>
    <div className="diagnosis-top"><div><span className="eyebrow">RULE-BASED ASSESSMENT</span><h3>Journey diagnosis</h3></div><RagBadge rag={journey.ragStatus} /></div>
    <div className="diagnosis-body">
      <div className="diagnosis-main"><strong>{journey.diagnosis}</strong><span>{journey.recommendation}</span></div>
      <div className="diagnosis-meta"><div><span>Demo rule-match confidence</span><strong>{journey.diagnosisConfidence}%</strong></div><div><span>Severity</span><strong className={`severity severity-${severity}`}>{journey.severity}</strong></div><div><span>Last successful stage</span><strong>{lastSuccess}</strong></div><div><span>First failed stage</span><strong>{firstFailure}</strong></div><div><span>Current owner</span><strong>{journey.currentOwner}</strong></div><div><span>Communication route</span><strong>{journey.communicationRoute}</strong></div>
        {journey.events.find((event) => event.errorCode) && <div><span>Error code</span><strong className="code-value">{journey.events.find((event) => event.errorCode)?.errorCode}</strong></div>}
        <div><span>Evidence freshness</span><strong>{formatTime(freshest)}</strong></div></div>
    </div>
  </section>;
}

function RelatedIdentifiers({ journey }: { journey: AsnJourney }) {
  const identifiers: [string, string | undefined][] = [
    ['Correlation ID', journey.correlationId], ['Container ID', journey.containerId], ['ASN ID', journey.asnId],
    ...journey.poNumbers.map((po, index): [string, string] => [`PO number ${index + 1}`, po]),
    ['URN ID', journey.urnId], ['Article number', journey.articleNumber], ['Trailer number', journey.trailerNumber],
    ...checkpointEvents(journey.events).flatMap((event) =>
      eventIdentifiers(event).map(([label, value]): [string, string | undefined] => [`${checkpointLabel(event)} · ${label}`, value])),
    ['WMS receipt reference', journey.receiptTimestamp ? `RCPT-${journey.asnId.slice(-6)}` : undefined],
  ];
  return <><p className="identifier-help">IDoc means Intermediate Document. Its SAP document number is a technical trace identifier, not the ASN ID. Each Middleware and PI/PO visit has its own message ID.</p><div className="identifier-list">{identifiers.map(([label, value]) => <div className="identifier-row" key={label}><span>{label}</span><code title={value}>{value ?? 'Not recorded'}</code></div>)}</div></>;
}

function SystemFieldCoverage({ journey }: { journey: AsnJourney }) {
  const fields: { key: keyof SupplierAsnFields; label: string }[] = [
    { key: 'containerId', label: 'Container ID' }, { key: 'asnId', label: 'ASN ID' },
    { key: 'asnStatus', label: 'ASN status' }, { key: 'poCount', label: 'Count of POs' }, { key: 'sumOfSingles', label: 'Sum of Singles' },
  ];
  return <><div className="detail-table-wrap"><table className="detail-table coverage-table"><thead><tr><th>Checkpoint</th>{fields.map(({ key, label }) => <th key={key}>{label}</th>)}<th>IBD date/time</th><th>OBD date/time</th><th>Technical trace</th></tr></thead>
    <tbody>{checkpointEvents(journey.events).map((event) => <tr key={event.checkpointId}><td><strong>{checkpointLabel(event)}</strong></td>
      {fields.map(({ key }) => {
        const supported = systemDetails[event.stageCode].exposesBusinessFields;
        const value = key === 'asnStatus' && event.businessFields ? asnStatusLabels[event.businessFields.asnStatus] : event.businessFields?.[key];
        return <td key={key} className={supported ? '' : 'field-not-exposed'}>{supported ? value ?? 'No evidence yet' : 'Not exposed'}</td>;
      })}
      <td>{formatTime(event.ibdTimestamp)}</td><td>{formatTime(event.obdTimestamp)}</td>
      <td>{eventIdentifiers(event).slice(0, 1).map(([label, value]) => <div key={label}>{label}<br /><code>{value ?? 'Not recorded'}</code></div>)}</td>
    </tr>)}</tbody></table></div><p className="coverage-help">MS is shown as Middleware. “Not exposed” means the system does not supply that business field, not that the journey failed. IBD / OBD are processing date/time values, separate from Middleware in/out timestamps. OpenText uses ediTrack’s field coverage in this prototype.</p></>;
}

function DetailTabContent({ journey, tab }: { journey: AsnJourney; tab: DetailTab }) {
  if (tab === 'Related identifiers') return <RelatedIdentifiers journey={journey} />;
  if (tab === 'System field coverage') return <SystemFieldCoverage journey={journey} />;
  if (tab === 'Raw mock event data') return <pre className="raw-json">{JSON.stringify(journey, null, 2)}</pre>;
  if (tab === 'Status history') return <div className="detail-table-wrap"><table className="detail-table"><thead><tr><th>Time</th><th>Previous status</th><th>New status</th><th>Checkpoint</th><th>Reason</th><th>Changed by</th></tr></thead><tbody>{[...journey.statusHistory].reverse().map((history) => <tr key={history.id}><td>{formatTime(history.timestamp)}</td><td>{statusLabels[history.fromStatus]}</td><td><JourneyBadge status={history.toStatus} /></td><td>{history.system === 'ASN360' ? 'ASN360' : history.checkpointId ? checkpointLabel({ checkpointId: history.checkpointId, stageCode: history.system }) : systemDetails[history.system].label}</td><td>{history.reason}</td><td>{history.changedBy}</td></tr>)}</tbody></table></div>;
  return <div className="detail-table-wrap"><table className="detail-table timeline-table"><thead><tr><th>Recorded</th><th>Checkpoint / event</th><th>Status</th><th>Middleware in/out</th><th>IBD date/time</th><th>OBD date/time</th><th>References / details</th></tr></thead><tbody>{journey.events.map((event) => <tr key={event.eventId}>
    <td>{formatTime(event.eventTimestamp)}</td><td><strong>{checkpointLabel(event)}</strong><br />{event.eventLabel}</td>
    <td><span className={`event-status-text rag-text-${eventRag(event.eventStatus).toLowerCase()}`}>{event.eventStatus.replaceAll('_', ' ')}</span></td>
    <td>{event.stageCode === 'MIDDLEWARE' && event.eventType === 'CHECKPOINT_STATUS' ? <>In: {formatTime(event.inTimestamp)}<br />Out: {formatTime(event.outTimestamp)}</> : 'Not applicable'}</td>
    <td>{event.eventType === 'CHECKPOINT_STATUS' ? formatTime(event.ibdTimestamp) : 'Not applicable'}</td><td>{event.eventType === 'CHECKPOINT_STATUS' ? formatTime(event.obdTimestamp) : 'Not applicable'}</td>
    <td>{eventIdentifiers(event).map(([label, value]) => <div key={label}>{label}: <code>{value ?? 'Not recorded'}</code></div>)}{event.errorMessage && <div>{event.errorMessage}</div>}</td>
  </tr>)}</tbody></table></div>;
}

function Toast({ toast, onClose }: { toast: ToastMessage; onClose: () => void }) {
  return <div className={`toast toast-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>{toast.type === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}<span>{toast.message}</span><button onClick={onClose} aria-label="Dismiss notification" type="button"><X size={16} /></button></div>;
}

function AsnDetails({ journey, onRecover, recovering }: {
  journey: AsnJourney;
  onRecover: () => void;
  recovering: boolean;
}) {
  const [tab, setTab] = useState<DetailTab>('Event timeline');
  const canRecover = Boolean(recoveryTarget(journey));
  return <section className="panel detail-panel">
    <div className="detail-header">
      <div className="detail-id-block"><span className="eyebrow">SELECTED SUPPLIER ASN</span><div className="detail-id"><h2>{journey.asnId}</h2><RagBadge rag={journey.ragStatus} /></div><div className="detail-subtitle">Container <strong>{journey.containerId}</strong><span>·</span><strong>{systemDetails[journey.sourceProvider].label}</strong></div></div>
      <div className="detail-actions"><JourneyBadge status={journey.status} />{canRecover && <button className="recover-button" type="button" onClick={onRecover} disabled={recovering}><RefreshCw size={15} />{recovering ? 'Saving recovery…' : 'Simulate recovery'}</button>}</div>
    </div>
    <RouteOverview journey={journey} />
    <div className="facts-wrap"><ShipmentFacts journey={journey} /></div>
    <Lifecycle journey={journey} />
    <DiagnosisPanel journey={journey} />
    <div className="tabs-header"><div className="detail-tabs" role="tablist" aria-label="ASN detail views">{detailTabs.map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} type="button" onClick={() => setTab(item)}>{item}</button>)}</div>
      <span className="simulated-tag"><ShieldCheck size={13} />Mock evidence</span></div>
    <DetailTabContent journey={journey} tab={tab} />
    <div className="detail-footnote"><HelpCircle size={14} />Seeded demonstration data only. ASN status is the business document status; journey badges describe technical health. Recovery is simulated and never confirms WMS receipt.</div>
  </section>;
}

export default function App() {
  const [pageId, setPageId] = useState<WorkspacePage | undefined>(() =>
    typeof window === 'undefined' ? 'dashboard' : pageFromHash(window.location.hash));
  const [day, setDay] = useState<AsnJourney['day']>('Today');
  const [journeys, setJourneys] = useState<AsnJourney[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const page = workspacePages.find((item) => item.id === pageId);
  const records = useMemo(() => journeys.filter((journey) => journey.day === day), [journeys, day]);
  const selected = records.find((journey) => journey.asnId === selectedId) ?? records[0];
  const loadJourneys = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const loaded = await fetchJourneys(signal);
      if (signal?.aborted) return;
      setJourneys(loaded);
      setSelectedId((current) => loaded.some((journey) => journey.asnId === current)
        ? current : loaded[0]?.asnId ?? '');
    } catch (error) {
      if (!signal?.aborted) setLoadError(error instanceof Error ? error.message : 'Unable to load ASN journeys.');
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void loadJourneys(controller.signal);
    return () => controller.abort();
  }, [loadJourneys]);
  useEffect(() => {
    const onHashChange = () => {
      setPageId(pageFromHash(window.location.hash));
      setMobileNavOpen(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    document.title = page ? page.id === 'dashboard' ? 'ASN360 Control Tower' : `${page.label} | ASN360 Control Tower` : 'Page not found | ASN360 Control Tower';
  }, [page]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const handleDay = (nextDay: AsnJourney['day']) => {
    setDay(nextDay);
    const next = journeys.find((journey) => journey.day === nextDay);
    if (next) setSelectedId(next.asnId);
  };
  const handleRecovery = async () => {
    if (!selected) {
      setToast({ message: 'Select an ASN journey before simulating recovery.', type: 'error' });
      return;
    }
    if (recoveringId) return;
    setRecoveringId(selected.asnId);
    try {
      const updated = await persistRecovery(selected.asnId);
      setJourneys((previous) => previous.map((record) => record.asnId === selected.asnId ? updated : record));
      setToast({ message: 'Recovery simulated and saved. Downstream processing and WMS receipt still require confirmation.', type: 'success' });
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : 'Recovery simulation failed.', type: 'error' });
    } finally {
      setRecoveringId(null);
    }
  };
  return <div className={`app-shell ${mobileNavOpen ? 'nav-open' : ''}`}>
    {mobileNavOpen && <button className="nav-scrim" aria-label="Close navigation" type="button" onClick={() => setMobileNavOpen(false)} />}
    <Sidebar page={pageId} queueCount={records.length} onNavigate={() => setMobileNavOpen(false)} />
    <main className="main-area">
      <Header day={day} setDay={handleDay} onMenu={() => setMobileNavOpen(!mobileNavOpen)} menuOpen={mobileNavOpen} breadcrumb={page?.breadcrumb ?? 'Page not found'} />
      <div className="page-content">
        <div className="page-title-row"><div><div className="page-overline"><span className="live-pulse" />{page?.overline ?? 'UNKNOWN WORKSPACE'} <span className="title-date">· {day}</span></div><h1>{page?.heading ?? 'Page not found'}</h1><p>{page?.description ?? 'This workspace link does not match an available demo page.'}</p></div><div className="last-updated"><span>DATA STORE</span><strong>Local MongoDB</strong></div></div>
        {isLoading && <div className="panel workspace-panel" role="status">Loading ASN journeys from MongoDB…</div>}
        {loadError && <section className="panel workspace-panel" role="alert"><h2>Could not load ASN journeys</h2><p>{loadError}</p><button className="workspace-button" type="button" onClick={() => void loadJourneys()}>Retry</button></section>}
        {!isLoading && !loadError && pageId === 'dashboard' && <SummaryGrid records={records} />}
        {!isLoading && !loadError && (pageId === 'dashboard' || pageId === 'asn-queue') && <div className="workspace-grid">
          <Queue key={day} records={records} selectedId={selected?.asnId ?? ''} onSelect={(record) => setSelectedId(record.asnId)} />
          {selected ? <AsnDetails key={selected.asnId} journey={selected} onRecover={handleRecovery} recovering={recoveringId === selected.asnId} /> : <div className="panel empty-details">No ASN records are available for this day.</div>}
        </div>}
        {!isLoading && !loadError && pageId === 'analytics' && <AnalyticsPage records={records} />}
        {!isLoading && !loadError && pageId === 'reports' && <ReportsPage records={records} day={day} onNotify={(message, type) => setToast({ message, type })} />}
        {!isLoading && !loadError && pageId === 'admin' && <AdminPage selectedDayCount={records.length} totalJourneyCount={journeys.length} />}
        {!page && <section className="panel workspace-panel" role="alert"><h2>Unknown workspace link</h2><p>Use the sidebar to open an available page.</p><a className="workspace-link" href="#dashboard">Return to Dashboard</a></section>}
        <footer className="page-footer"><span>ASN360 <i>·</i> Control Tower prototype</span><span><Truck size={14} /> Advance Shipping Notice visibility</span></footer>
      </div>
    </main>
    {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
  </div>;
}
