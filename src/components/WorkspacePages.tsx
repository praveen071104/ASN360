import { useMemo, useState } from 'react';
import { ArrowRight, Download, ShieldCheck } from 'lucide-react';
import type { AsnJourney, StageCode } from '../types/asn';
import { getJourneyStages, journeyRoutes, routeLabels, sourceProviders, systemDetails } from '../utils/journey';
import {
  buildReport, reportCsv, reportDefinitions, summarizeJourneys, type ReportKind, type VolumeBucket,
} from '../utils/reporting';

function VolumePanel({ title, buckets, total }: { title: string; buckets: VolumeBucket[]; total: number }) {
  return <section className="panel workspace-panel">
    <h2>{title}</h2>
    <div className="volume-list">{buckets.map((bucket) => <div className="volume-row" key={bucket.key}>
      <div><strong>{bucket.label}</strong><span>{bucket.total} ASNs</span></div>
      <meter min={0} max={Math.max(total, 1)} value={bucket.total} aria-label={`${bucket.label} volume`} />
      <p>{bucket.received} confirmed receipts &middot; {bucket.failed} confirmed failures</p>
    </div>)}</div>
  </section>;
}

export function AnalyticsPage({ records }: { records: AsnJourney[] }) {
  const analytics = useMemo(() => summarizeJourneys(records), [records]);
  const metrics = [
    { label: 'Total journeys', value: String(analytics.total), detail: 'Across the selected day' },
    { label: 'Confirmed receipts', value: `${analytics.receiptPercent}%`, detail: `${analytics.received} of ${analytics.total} journeys` },
    { label: 'Confirmed failures', value: String(analytics.failed), detail: 'At least one failed checkpoint' },
    { label: 'Open journeys', value: String(analytics.open), detail: 'No confirmed WMS receipt yet' },
  ];
  return <section className="workspace-page" aria-label="Analytics workspace">
    <div className="metric-grid">{metrics.map((metric) => <article className="summary-card metric-card" key={metric.label}>
      <span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small>
    </article>)}</div>
    <div className="analytics-grid">
      <section className="panel workspace-panel">
        <h2>Journey status</h2>
        <div className="status-distribution">{analytics.statuses.map((bucket) => <div className={`status-row status-${bucket.key.toLowerCase()}`} key={bucket.key}>
          <div><span className={`journey-badge journey-${bucket.key.toLowerCase()}`}>{bucket.label}</span><strong>{bucket.count}</strong></div>
          <meter min={0} max={Math.max(analytics.total, 1)} value={bucket.count} aria-label={`${bucket.label} journeys`} />
        </div>)}</div>
      </section>
      <VolumePanel title="Source providers" buckets={analytics.providers} total={analytics.total} />
      <VolumePanel title="Processing routes" buckets={analytics.routes} total={analytics.total} />
    </div>
    <div className="analytics-detail-grid">
      <section className="panel workspace-panel">
        <h2>Checkpoint exceptions</h2>
        <p className="workspace-note">Repeated Middleware and PI/PO visits are counted separately. Upstream-blocked checkpoints are not counted as independent failures.</p>
        <div className="workspace-table-wrap"><table className="workspace-data-table"><thead><tr><th>Checkpoint</th><th>Failed</th><th>Waiting</th><th>Unknown</th><th>Owner</th></tr></thead>
          <tbody>{analytics.exceptions.map((bucket) => <tr key={bucket.key}><td>{bucket.label}</td><td>{bucket.failed}</td><td>{bucket.waiting}</td><td>{bucket.unknown}</td><td>{bucket.owner}</td></tr>)}
            {analytics.exceptions.length === 0 && <tr><td colSpan={5} className="workspace-empty">No checkpoint exceptions for the selected day.</td></tr>}
          </tbody></table></div>
      </section>
      <section className="panel workspace-panel">
        <h2>Middleware processing times</h2>
        <p className="workspace-note">Average in-to-out duration for COMPLETE checkpoints only. Pending, missing, and simulated retry evidence is excluded.</p>
        <div className="timing-list">{analytics.middleware.map((timing) => <div key={timing.id}>
          <span>{timing.label}</span><strong>{timing.averageMinutes === null ? 'Not available' : `${timing.averageMinutes.toFixed(1)} min`}</strong>
          <small>{timing.samples} completed visits &middot; {timing.excluded} excluded</small>
        </div>)}</div>
      </section>
    </div>
    <p className="workspace-note">These metrics are calculated from the current demo journeys, including any simulated recovery state. They are not live service performance or SLA measurements.</p>
  </section>;
}

export function ReportsPage({ records, day, onNotify }: {
  records: AsnJourney[];
  day: AsnJourney['day'];
  onNotify: (message: string, type: 'success' | 'error') => void;
}) {
  const [kind, setKind] = useState<ReportKind>('journeys');
  const definition = reportDefinitions[kind === 'journeys' ? 0 : 1];
  const report = useMemo(() => buildReport(records, kind), [records, kind]);
  const preview = report.rows.slice(0, 8);
  const handleDownload = () => {
    if (!report.rows.length) {
      onNotify('There are no report rows for the selected day.', 'error');
      return;
    }
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      url = URL.createObjectURL(new Blob([reportCsv(report)], { type: 'text/csv;charset=utf-8' }));
      link = document.createElement('a');
      link.href = url;
      link.download = `asn360-${kind}-${day.toLowerCase().replaceAll(' ', '-')}.csv`;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      onNotify(`CSV download started: ${report.rows.length} rows for ${day}.`, 'success');
    } catch (error) {
      onNotify(error instanceof Error ? `CSV export failed: ${error.message}` : 'CSV export failed.', 'error');
    } finally {
      link?.remove();
      if (url) {
        const downloadUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    }
  };
  return <section className="workspace-page" aria-label="Reports workspace">
    <section className="panel workspace-panel">
      <div className="report-toolbar">
        <label className="workspace-select">Report type<select value={kind} aria-label="Report type" onChange={(event) => {
          const selected = reportDefinitions.find((option) => option.id === event.target.value);
          if (!selected) {
            onNotify('The selected report type is not supported.', 'error');
            return;
          }
          setKind(selected.id);
        }}>{reportDefinitions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <div className="report-scope"><span>Selected day</span><strong>{day}</strong><small>{records.length} ASN journeys &middot; {report.rows.length} export rows</small></div>
        <button className="workspace-button" type="button" onClick={handleDownload} disabled={report.rows.length === 0}><Download size={16} aria-hidden="true" />Download CSV</button>
      </div>
      <p className="workspace-note">{definition.description} The export includes all rows, not just the preview. Timestamps are exported in UTC as stored.</p>
    </section>
    <section className="panel workspace-panel report-preview">
      <div className="workspace-panel-heading"><h2>{definition.label}</h2><span>Preview: {preview.length} of {report.rows.length} rows</span></div>
      <div className="workspace-table-wrap"><table className="workspace-data-table report-table"><thead><tr>{report.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{preview.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={report.headers[column]}>{value === '' ? 'Not recorded' : value}</td>)}</tr>)}
          {preview.length === 0 && <tr><td colSpan={report.headers.length} className="workspace-empty">No records are available for the selected day.</td></tr>}
        </tbody></table></div>
    </section>
    <p className="workspace-note">CSV files contain mock data currently stored in MongoDB; downloads are saved locally by your browser. Formula-prefixed text is exported as literal text for spreadsheet safety. Import identifier columns as text to preserve leading zeros in SAP IDoc numbers.</p>
  </section>;
}

const systemIdentifiers: Record<StageCode, string> = {
  EDITRACK: 'Provider reference', OPEN_TEXT: 'Provider reference', MIDDLEWARE: 'Message ID',
  SAP_PI_PO: 'Message ID / linked IDoc when provided', SAP: 'SAP IDoc number',
  GLOBAL_INBOUND: 'GI transaction ID', WMS: 'Import / receipt reference',
};

export function AdminPage({ selectedDayCount, totalJourneyCount }: { selectedDayCount: number; totalJourneyCount: number }) {
  const systems = [...new Set(sourceProviders.flatMap((source) => journeyRoutes.flatMap((route) =>
    getJourneyStages(source, route).map((stage) => stage.code))))];
  return <section className="workspace-page" aria-label="Admin workspace">
    <div className="read-only-banner"><ShieldCheck size={21} aria-hidden="true" /><div><strong>Read-only demo configuration</strong><p>Journeys and simulated recovery changes are stored in MongoDB. Upstream system evidence remains synthetic; no production connectors or credentials are configured.</p></div></div>
    <section className="panel workspace-panel">
      <h2>Environment</h2>
      <dl className="config-summary"><div><dt>Data mode</dt><dd>Mock data in MongoDB</dd></div><div><dt>Live source systems</dt><dd>None</dd></div><div><dt>Loaded journeys</dt><dd>{totalJourneyCount}</dd></div><div><dt>Selected-day journeys</dt><dd>{selectedDayCount}</dd></div></dl>
      <p className="workspace-note">The selected day is shared across Dashboard, ASN Queue, Analytics, and Reports. Recovery simulations are persisted in the local MongoDB database.</p>
    </section>
    <section className="panel workspace-panel">
      <h2>Configured source and route combinations</h2>
      <p className="workspace-note">Each ASN explicitly supplies its source and route. Neither provider is hard-wired to SAP or GI.</p>
      <div className="config-route-grid">{sourceProviders.flatMap((source) => journeyRoutes.map((route) => {
        const stages = getJourneyStages(source, route);
        return <article className="config-route" key={`${source}-${route}`}>
          <h3>{systemDetails[source].label} &middot; {routeLabels[route]} <span>{stages.length} checkpoints</span></h3>
          <ol className="route-path">{stages.map((stage, index) => <li key={stage.id}>{index > 0 && <ArrowRight size={12} aria-hidden="true" />}<span>{systemDetails[stage.code].label}</span></li>)}</ol>
        </article>;
      }))}</div>
    </section>
    <section className="panel workspace-panel">
      <h2>System capabilities and ownership</h2>
      <div className="workspace-table-wrap"><table className="workspace-data-table"><thead><tr><th>System</th><th>Owner</th><th>Business fields</th><th>Trace identifier</th><th>Connection</th></tr></thead>
        <tbody>{systems.map((code) => <tr key={code}><td>{systemDetails[code].label}</td><td>{systemDetails[code].owner}</td><td>{systemDetails[code].exposesBusinessFields ? 'Available' : 'Technical trace only'}</td><td>{systemIdentifiers[code]}</td><td>MongoDB mock data</td></tr>)}</tbody>
      </table></div>
      <p className="workspace-note">MS is Middleware. Middleware and SAP PI/PO do not expose the supplier business fields directly. OpenText uses ediTrack field coverage for this demo. IBD/OBD processing timestamps are separate from Middleware in/out timestamps.</p>
      <a className="workspace-link" href="#asn-queue">Inspect ASN checkpoint evidence <ArrowRight size={14} aria-hidden="true" /></a>
    </section>
  </section>;
}
