const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../middleware/auth');

let pool;
try { pool = require('../config/db'); } catch(e) { pool = null; }

const dbOk = async () => {
  if (!pool) return false;
  try { await pool.execute('SELECT 1'); return true; } catch(e) { return false; }
};

// GET /api/employees
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1, limit = 20,
      shop_code, department, category, status, search, empno,
      from_date, to_date,
      sf_code,   // 'Fur' | 'Shell'
      gender,    // 'Male' | 'Female'
    } = req.query;

    console.log('--- EMPLOYEES ROUTE QUERY ---', { shop_code, status, from_date, to_date, sf_code, gender, empno });
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params     = [];

    if (shop_code)  { conditions.push('e.shop_code = ?');  params.push(shop_code); }
    if (department) { conditions.push('e.department = ?'); params.push(department); }
    if (category)   { conditions.push('e.category = ?');   params.push(category); }
    if (gender)     { conditions.push('e.gender = ?');     params.push(gender); }
    if (sf_code) {
      if (sf_code === 'Unknown') {
        conditions.push('(e.sf_code IS NULL OR e.sf_code NOT IN (\'Fur\',\'Shell\'))');
      } else {
        conditions.push('e.sf_code = ?');
        params.push(sf_code);
      }
    }
    if (empno) {
      conditions.push('e.empno LIKE ?');
      params.push(`%${empno}%`);
    }
    if (search) {
      conditions.push('(e.EMISCARDNUMBER LIKE ? OR e.emp_name LIKE ? OR e.empno LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Status and Date filters
    if (status || from_date || to_date) {
      const fromDate = from_date || new Date(Date.now() - 365*24*60*60*1000).toISOString().split('T')[0];
      const toDate   = to_date   || new Date().toISOString().split('T')[0];

      if (status === 'Active' || status === 'Sick') {
        conditions.push(`EXISTS (
          SELECT 1 FROM sick_fit_records r
          WHERE r.EMISCARDNUMBER = e.EMISCARDNUMBER
            AND r.fit_date IS NULL
            AND r.sick_date BETWEEN ? AND ?
        )`);
        params.push(fromDate, toDate);
      } else if (status === 'Resolved' || status === 'Recovered' || status === 'Fit') {
        conditions.push(`EXISTS (
          SELECT 1 FROM sick_fit_records r
          WHERE r.EMISCARDNUMBER = e.EMISCARDNUMBER
            AND r.fit_date IS NOT NULL
            AND r.sick_date BETWEEN ? AND ?
        )`);
        params.push(fromDate, toDate);
      } else {
        conditions.push(`EXISTS (
          SELECT 1 FROM sick_fit_records r
          WHERE r.EMISCARDNUMBER = e.EMISCARDNUMBER
            AND r.sick_date BETWEEN ? AND ?
        )`);
        params.push(fromDate, toDate);
      }
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Total count
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM employees e ${where}`, params
    );

    const lim = parseInt(limit);
    const off  = parseInt(offset);

    // Main employee query — show UMID, empno, name, dept (from CUG), payunit, sf_code, gender, category
    const [rows] = await pool.query(`
      SELECT
        e.EMISCARDNUMBER,
        e.empno,
        e.emp_name,
        e.department,
        e.shop_code,
        e.payunit,
        e.sf_code,
        e.gender,
        e.category,
        e.is_active,
        (SELECT r.status      FROM sick_fit_records r WHERE r.EMISCARDNUMBER=e.EMISCARDNUMBER ORDER BY r.sick_date DESC LIMIT 1) AS current_status,
        (SELECT r.sick_date   FROM sick_fit_records r WHERE r.EMISCARDNUMBER=e.EMISCARDNUMBER ORDER BY r.sick_date DESC LIMIT 1) AS last_sick_date,
        (SELECT r.fit_date    FROM sick_fit_records r WHERE r.EMISCARDNUMBER=e.EMISCARDNUMBER ORDER BY r.sick_date DESC LIMIT 1) AS last_fit_date,
        (SELECT r.days_count  FROM sick_fit_records r WHERE r.EMISCARDNUMBER=e.EMISCARDNUMBER ORDER BY r.sick_date DESC LIMIT 1) AS days_count,
        (SELECT r.diagnosis   FROM sick_fit_records r WHERE r.EMISCARDNUMBER=e.EMISCARDNUMBER ORDER BY r.sick_date DESC LIMIT 1) AS last_diagnosis
      FROM employees e
      ${where}
      ORDER BY e.emp_name
      LIMIT ${lim} OFFSET ${off}
    `, params);

    // Summary: gender counts + SF counts for the current filter set
    const [genderCounts] = await pool.execute(
      `SELECT gender, COUNT(*) AS cnt FROM employees e ${where} GROUP BY gender`, params
    );
    const [sfCounts] = await pool.execute(
      `SELECT COALESCE(sf_code,'Unknown') AS sf_code, COUNT(*) AS cnt FROM employees e ${where} GROUP BY sf_code`, params
    );

    const summary = {
      male:    0, female: 0,
      fur:     0, shell:  0, sf_unknown: 0,
    };
    for (const g of genderCounts) {
      if (g.gender === 'Male')   summary.male   = parseInt(g.cnt);
      if (g.gender === 'Female') summary.female = parseInt(g.cnt);
    }
    for (const s of sfCounts) {
      if (s.sf_code === 'Fur')     summary.fur        = parseInt(s.cnt);
      if (s.sf_code === 'Shell')   summary.shell      = parseInt(s.cnt);
      if (s.sf_code === 'Unknown') summary.sf_unknown = parseInt(s.cnt);
    }

    const total = countRows[0].total;
    return res.json({
      success: true,
      data: rows,
      summary,
      pagination: {
        total,
        page:  parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch(err) {
    console.error('Employees route error:', err.message);
    res.status(500).json({ success: false, message: 'Database error: ' + err.message });
  }
});

// GET /api/employees/:emiscardnumber
router.get('/:emiscardnumber', authenticateToken, async (req, res) => {
  try {
    const { emiscardnumber } = req.params;
    const [empRows] = await pool.execute(`
      SELECT e.*
      FROM employees e
      WHERE e.EMISCARDNUMBER = ?
    `, [emiscardnumber]);

    if (empRows.length === 0)
      return res.status(404).json({ success: false, message: 'Employee not found' });

    const [historyRows] = await pool.execute(
      `SELECT * FROM sick_fit_records WHERE EMISCARDNUMBER = ? ORDER BY sick_date DESC`,
      [emiscardnumber]
    );

    return res.json({ success: true, data: { employee: empRows[0], history: historyRows } });
  } catch(err) {
    console.error('Employee detail error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
