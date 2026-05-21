const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../middleware/auth');

let pool;
try { pool = require('../config/db'); } catch(e) { pool = null; }

// Helper to build common WHERE conditions based on filters
function buildWhere(query, useDate = true) {
  const { from_date, to_date, shop_code, sf_code, gender } = query;
  const fromDate = from_date || new Date(Date.now() - 365*24*60*60*1000).toISOString().split('T')[0];
  const toDate   = to_date   || new Date().toISOString().split('T')[0];

  const conditions = [];
  const params = [];

  if (useDate) {
    conditions.push('r.sick_date BETWEEN ? AND ?');
    params.push(fromDate, toDate);
  }

  if (shop_code) {
    conditions.push('e.shop_code = ?');
    params.push(shop_code);
  }
  if (sf_code) {
    conditions.push('e.sf_code = ?');
    params.push(sf_code);
  }
  if (gender) {
    conditions.push('e.gender = ?');
    params.push(gender);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  return { where, params };
}

// GET /api/dashboard/kpi
router.get('/kpi', authenticateToken, async (req, res) => {
  try {
    const { where, params } = buildWhere(req.query, true);
    const { where: whereNoDate, params: paramsNoDate } = buildWhere(req.query, false);

    // 1. Total Sick Cases (combined Currently Sick + Resolved Cases)
    const [[{ total_sick_cases }]] = await pool.execute(`
      SELECT COUNT(DISTINCT r.EMISCARDNUMBER) AS total_sick_cases
      FROM sick_fit_records r
      JOIN employees e ON r.EMISCARDNUMBER = e.EMISCARDNUMBER
      ${where}
    `, params);

    // 2. Supervisory Sick Cases (Supervisory count in the sick list)
    const [[{ total_supervisory }]] = await pool.execute(`
      SELECT COUNT(DISTINCT r.EMISCARDNUMBER) AS total_supervisory
      FROM sick_fit_records r
      JOIN employees e ON r.EMISCARDNUMBER = e.EMISCARDNUMBER
      ${where} AND e.category = 'Supervisory'
    `, params);

    // 3. Non-Supervisory Sick Cases (Non-Supervisory count in the sick list)
    const [[{ total_non_supervisory }]] = await pool.execute(`
      SELECT COUNT(DISTINCT r.EMISCARDNUMBER) AS total_non_supervisory
      FROM sick_fit_records r
      JOIN employees e ON r.EMISCARDNUMBER = e.EMISCARDNUMBER
      ${where} AND e.category = 'Non-Supervisory'
    `, params);

    // 4. Current Week Cases
    const [[{ current_week_cases }]] = await pool.execute(`
      SELECT COUNT(DISTINCT r.EMISCARDNUMBER) AS current_week_cases
      FROM sick_fit_records r
      JOIN employees e ON r.EMISCARDNUMBER = e.EMISCARDNUMBER
      ${whereNoDate ? whereNoDate + ' AND' : 'WHERE'} WEEK(r.sick_date, 1) = WEEK(CURDATE(), 1)
        AND YEAR(r.sick_date) = YEAR(CURDATE())
    `, paramsNoDate);

    // 5. Monthly Cases
    const [[{ monthly_cases }]] = await pool.execute(`
      SELECT COUNT(DISTINCT r.EMISCARDNUMBER) AS monthly_cases
      FROM sick_fit_records r
      JOIN employees e ON r.EMISCARDNUMBER = e.EMISCARDNUMBER
      ${whereNoDate ? whereNoDate + ' AND' : 'WHERE'} MONTH(r.sick_date) = MONTH(CURDATE())
        AND YEAR(r.sick_date) = YEAR(CURDATE())
    `, paramsNoDate);

    // 6. Shops Affected
    const [[{ shops_affected }]] = await pool.execute(`
      SELECT COUNT(DISTINCT e.shop_code) AS shops_affected
      FROM sick_fit_records r
      JOIN employees e ON r.EMISCARDNUMBER = e.EMISCARDNUMBER
      ${where} AND e.shop_code IS NOT NULL AND e.shop_code != 'ICF'
    `, params);

    // 7. Active SSE Count
    // If sf_code is passed, only count SSEs belonging to shops of that division
    let sseQuery = 'SELECT COUNT(DISTINCT c.EMISCARDNUMBER) AS active_sse_count FROM cug_contacts c WHERE c.is_active=1';
    let sseParams = [];
    if (req.query.sf_code) {
      sseQuery = `
        SELECT COUNT(DISTINCT c.EMISCARDNUMBER) AS active_sse_count 
        FROM cug_contacts c 
        JOIN employees e ON c.EMISCARDNUMBER = e.EMISCARDNUMBER
        WHERE c.is_active=1 AND e.sf_code = ?
      `;
      sseParams.push(req.query.sf_code);
    }
    const [[{ active_sse_count }]] = await pool.execute(sseQuery, sseParams);

    return res.json({
      success: true,
      data: {
        total_sick_cases,
        total_supervisory,
        total_non_supervisory,
        current_week_cases,
        monthly_cases,
        shops_affected,
        active_sse_count
      }
    });
  } catch(err) {
    console.error('KPI error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/dashboard/daywise-trend
router.get('/daywise-trend', authenticateToken, async (req, res) => {
  try {
    const { where, params } = buildWhere(req.query, true);
    const [rows] = await pool.execute(`
      SELECT DATE(r.sick_date) AS trend_date,
        SUM(CASE WHEN r.fit_date IS NULL THEN 1 ELSE 0 END) AS sick_count,
        SUM(CASE WHEN r.fit_date IS NOT NULL THEN 1 ELSE 0 END) AS fit_count,
        COUNT(*) AS total_count
      FROM sick_fit_records r
      JOIN employees e ON r.EMISCARDNUMBER=e.EMISCARDNUMBER
      ${where}
      GROUP BY DATE(r.sick_date)
      ORDER BY trend_date
    `, params);

    return res.json({ success: true, data: rows });
  } catch(err) {
    console.error('Daywise trend error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/dashboard/shop-distribution
router.get('/shop-distribution', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date, shop_code, sf_code, gender } = req.query;
    const fromDate = from_date || new Date(Date.now()-365*24*60*60*1000).toISOString().split('T')[0];
    const toDate   = to_date   || new Date().toISOString().split('T')[0];

    const conditions = [];
    const params = [];

    conditions.push('r.sick_date BETWEEN ? AND ?');
    params.push(fromDate, toDate);

    if (shop_code) { conditions.push('s.shop_code = ?'); params.push(shop_code); }
    if (sf_code)   { conditions.push('e.sf_code = ?');   params.push(sf_code); }
    if (gender)    { conditions.push('e.gender = ?');    params.push(gender); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [rows] = await pool.execute(`
      SELECT
        s.shop_code, s.shop_name, s.department,
        COUNT(DISTINCT e.EMISCARDNUMBER) AS total_employees,
        COUNT(CASE WHEN r.status='Sick' AND r.fit_date IS NULL THEN 1 END) AS sick_count,
        COUNT(CASE WHEN r.status='Fit'  THEN 1 END) AS fit_count,
        COUNT(r.record_id) AS total_cases
      FROM shops s
      LEFT JOIN employees e ON s.shop_code = e.shop_code
      LEFT JOIN sick_fit_records r
        ON e.EMISCARDNUMBER = r.EMISCARDNUMBER
      ${where}
      GROUP BY s.shop_code, s.shop_name, s.department
      ORDER BY total_cases DESC, total_employees DESC
      LIMIT 30
    `, params);

    return res.json({ success: true, data: rows });
  } catch(err) {
    console.error('Shop distribution error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/dashboard/category-distribution
router.get('/category-distribution', authenticateToken, async (req, res) => {
  try {
    const { where, params } = buildWhere(req.query, true);
    const [rows] = await pool.execute(`
      SELECT e.category,
        COUNT(DISTINCT e.EMISCARDNUMBER) AS total_employees,
        COUNT(DISTINCT r.EMISCARDNUMBER) AS sick_employees
      FROM employees e
      LEFT JOIN sick_fit_records r ON e.EMISCARDNUMBER = r.EMISCARDNUMBER
      ${where}
      GROUP BY e.category
    `, params);

    return res.json({ success: true, data: rows });
  } catch(err) {
    console.error('Category distribution error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/dashboard/division-stats
router.get('/division-stats', authenticateToken, async (req, res) => {
  try {
    const { where, params } = buildWhere(req.query, true);

    // Count sick employees in the selected period by division and gender
    const [rows] = await pool.execute(`
      SELECT 
        e.sf_code, 
        e.gender, 
        COUNT(DISTINCT e.EMISCARDNUMBER) as count 
      FROM employees e
      JOIN sick_fit_records r ON e.EMISCARDNUMBER = r.EMISCARDNUMBER
      ${where} AND e.sf_code IN ('Fur', 'Shell')
      GROUP BY e.sf_code, e.gender
    `, params);
    
    const stats = {
      Fur: { Male: 0, Female: 0, Total: 0 },
      Shell: { Male: 0, Female: 0, Total: 0 }
    };
    
    rows.forEach(r => {
      const division = r.sf_code;
      const gender = r.gender;
      const count = parseInt(r.count);
      if (stats[division] && (gender === 'Male' || gender === 'Female')) {
        stats[division][gender] = count;
        stats[division].Total += count;
      }
    });

    return res.json({ success: true, data: stats });
  } catch(err) {
    console.error('Division stats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/dashboard/recent-sick
router.get('/recent-sick', authenticateToken, async (req, res) => {
  try {
    const { where, params } = buildWhere(req.query, true);
    const [rows] = await pool.execute(`
      SELECT DISTINCT
        e.EMISCARDNUMBER,
        e.empno,
        e.emp_name,
        e.designation,
        e.department,
        e.shop_code,
        r.status,
        r.sick_date as last_sick_date,
        r.fit_date as last_fit_date
      FROM sick_fit_records r
      JOIN employees e ON r.EMISCARDNUMBER = e.EMISCARDNUMBER
      ${where}
      ORDER BY r.sick_date DESC
      LIMIT 10
    `, params);
    return res.json({ success: true, data: rows });
  } catch(err) {
    console.error('Recent sick error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
