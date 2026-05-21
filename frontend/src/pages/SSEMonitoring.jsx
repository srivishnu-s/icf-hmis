import React, { useState, useEffect } from 'react';
import { Users2, Phone, Building2 } from 'lucide-react';
import SSEPerformanceChart from '../components/dashboard/SSEPerformanceChart';
import api from '../utils/api';

const SSEMonitoring = () => {
  const [contacts, setContacts] = useState([]);
  const [ssePerf, setSsePerf]   = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.get('/sse-monitoring/contacts'),
      api.get('/analytics/sse-performance'),
    ]).then(([contRes, perfRes]) => {
      if (contRes.status === 'fulfilled') setContacts(contRes.value.data.data || []);
      if (perfRes.status === 'fulfilled') setSsePerf(perfRes.value.data.data || []);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
          <Users2 className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200">SSE Monitoring</h2>
          <p className="text-sm text-gray-400">Section Engineer contacts and performance overview</p>
        </div>
      </div>

      <SSEPerformanceChart data={ssePerf} loading={loading} />

      {/* SSE Contact Cards */}
      <div>
        <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-4">SSE Contact Directory</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? (
            [...Array(6)].map((_, i) => <div key={i} className="skeleton h-32 rounded-2xl" />)
          ) : contacts.map(c => (
            <div key={c.contact_id} className="glass-card p-4 hover:shadow-hover transition-all duration-200">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center text-primary-600 font-bold text-sm">
                  {c.sse_name?.[0] || 'S'}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.current_sick_count > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                  {c.current_sick_count > 0 ? `${c.current_sick_count} Sick` : 'All Clear'}
                </span>
              </div>
              <h4 className="font-semibold text-gray-800 dark:text-gray-200 text-sm">{c.sse_name}</h4>
              <p className="text-xs text-gray-500 mt-0.5">{c.designation}</p>
              <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                <div className="flex items-center gap-1">
                  <Building2 className="w-3 h-3" />
                  <span className="font-medium text-primary-600">{c.shop_code}</span>
                </div>
                <a href={`tel:${c.cug_number}`} className="flex items-center gap-1 text-green-600 hover:underline font-medium">
                  <Phone className="w-3 h-3" />
                  {c.cug_number}
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SSEMonitoring;
