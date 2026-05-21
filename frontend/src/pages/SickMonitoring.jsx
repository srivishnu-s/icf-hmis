import React, { useState, useEffect } from 'react';
import { Activity, AlertTriangle, Download } from 'lucide-react';
import AdvancedFilters from '../components/filters/AdvancedFilters';
import EmployeeTable from '../components/tables/EmployeeTable';
import api from '../utils/api';

const defaultFilters = {
  from_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  to_date:   new Date().toISOString().split('T')[0],
  shop_code: '', category: '', search: '', empno: '',
  sf_code: '', gender: '',
};

// Small summary card
const SummaryCard = ({ label, value, color, icon }) => (
  <div className={`glass-card px-4 py-3 flex items-center gap-3 border-l-4 ${color}`}>
    <div className="text-2xl">{icon}</div>
    <div>
      <p className="text-xs text-gray-500 font-medium">{label}</p>
      <p className="text-xl font-bold text-gray-800 dark:text-gray-100">{value ?? '—'}</p>
    </div>
  </div>
);

const SickMonitoring = () => {
  const [filters, setFilters]       = useState(defaultFilters);
  const [data, setData]             = useState([]);
  const [pagination, setPagination] = useState(null);
  const [summary, setSummary]       = useState(null);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(true);
  const [exporting, setExporting]   = useState(false);

  const downloadExcel = () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('icf_token');
      const p = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) p.append(k, v); });
      window.location.href = `/api/reports/export/excel?${p.toString()}&token=${token}`;
    } catch (e) {
      alert('Export failed');
    } finally {
      setTimeout(() => setExporting(false), 2000);
    }
  };

  useEffect(() => {
    setLoading(true);
    api.get('/employees', { params: { ...filters, page, limit: 20 } })
      .then(r => {
        setData(r.data.data || []);
        setPagination(r.data.pagination);
        setSummary(r.data.summary || null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filters, page]);

  // Decide which SF cards to show based on filter
  const showFur   = !filters.sf_code || filters.sf_code === 'Fur';
  const showShell = !filters.sf_code || filters.sf_code === 'Shell';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <Activity className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200">Sick Monitoring</h2>
            <p className="text-sm text-gray-400">
              Track employees on active or resolved sick leaves — data from CUG &amp; EMPNO registers
            </p>
          </div>
        </div>
        <button
          onClick={downloadExcel}
          disabled={exporting}
          className="btn-primary bg-green-500 hover:bg-green-600 flex items-center gap-2"
        >
          {exporting ? (
            <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Exporting...</>
          ) : (
            <><Download className="w-4 h-4" /> Export to Excel</>
          )}
        </button>
      </div>

      {/* Filters */}
      <AdvancedFilters
        filters={filters}
        onChange={f => { setFilters(f); setPage(1); }}
        onReset={() => { setFilters(defaultFilters); setPage(1); }}
      />

      {/* Summary Cards */}
      {summary && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">

          {/* Gender */}
          <SummaryCard
            label="Total Male"
            value={summary.male}
            color="border-blue-400"
            icon="♂️"
          />
          <SummaryCard
            label="Total Female"
            value={summary.female}
            color="border-pink-400"
            icon="♀️"
          />

          {/* Fur/Shell */}
          {showFur && (
            <SummaryCard
              label="Fur Division"
              value={summary.fur}
              color="border-amber-400"
              icon="🔶"
            />
          )}
          {showShell && (
            <SummaryCard
              label="Shell Division"
              value={summary.shell}
              color="border-indigo-400"
              icon="🔷"
            />
          )}

          {/* Total */}
          <SummaryCard
            label="Total Records"
            value={pagination?.total ?? data.length}
            color="border-red-400"
            icon="📋"
          />
          <SummaryCard
            label="Sick (Active)"
            value={data.filter(e => !e.last_fit_date && e.last_sick_date).length}
            color="border-orange-400"
            icon="🔴"
          />
        </div>
      )}

      {/* Alert banner */}
      {!loading && data.length > 0 && (
        <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-400">
            <strong>{pagination?.total || data.length}</strong> sick employee records found in the selected period.
            {filters.sf_code && (
              <span className="ml-2 font-semibold">
                Showing {filters.sf_code === 'Fur' ? '🔶 Fur' : '🔷 Shell'} Division only.
              </span>
            )}
          </p>
        </div>
      )}

      {/* Table */}
      <EmployeeTable
        data={data}
        pagination={pagination}
        onPageChange={setPage}
        loading={loading}
      />
    </div>
  );
};

export default SickMonitoring;
