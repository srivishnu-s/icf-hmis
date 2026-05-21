const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const mock = require('../config/mockData');

let pool;
try { pool = require('../config/db'); } catch(e) { pool = null; }
const isDbAvailable = async () => {
  if (!pool) return false;
  try { await pool.execute('SELECT 1'); return true; } catch(e) { return false; }
};

router.get('/weekly', authenticateToken, async (req, res) => {
  try {
    if (await isDbAvailable()) {
      const { shop_code } = req.query;
      let shopFilter = shop_code ? ' AND e.shop_code=?' : '';
      const p = []; if (shop_code) p.push(shop_code);
      const [newCases] = await pool.execute(`
        SELECT r.*, e.emp_name, e.designation, e.shop_code, s.shop_name, e.category
        FROM sick_fit_records r JOIN employees e ON r.EMISCARDNUMBER=e.EMISCARDNUMBER
        LEFT JOIN shops s ON e.shop_code=s.shop_code
        WHERE WEEK(r.sick_date,1)=WEEK(CURDATE(),1) AND YEAR(r.sick_date)=YEAR(CURDATE()) ${shopFilter}
        ORDER BY r.sick_date DESC
      `, p);
      const [recovered] = await pool.execute(`
        SELECT r.*, e.emp_name, e.designation, e.shop_code, s.shop_name
        FROM sick_fit_records r JOIN employees e ON r.EMISCARDNUMBER=e.EMISCARDNUMBER
        LEFT JOIN shops s ON e.shop_code=s.shop_code
        WHERE r.fit_date IS NOT NULL AND WEEK(r.fit_date,1)=WEEK(CURDATE(),1) AND YEAR(r.fit_date)=YEAR(CURDATE()) ${shopFilter}
        ORDER BY r.fit_date DESC
      `, p);
      const [pending] = await pool.execute(`
        SELECT r.*, e.emp_name, e.designation, e.shop_code, s.shop_name, DATEDIFF(CURDATE(),r.sick_date) AS days_pending
        FROM sick_fit_records r JOIN employees e ON r.EMISCARDNUMBER=e.EMISCARDNUMBER
        LEFT JOIN shops s ON e.shop_code=s.shop_code
        WHERE r.fit_date IS NULL AND r.status='Sick' AND DATEDIFF(CURDATE(),r.sick_date)>7 ${shopFilter}
        ORDER BY days_pending DESC
      `, p);
      const [recurring] = await pool.execute(`
        SELECT r.EMISCARDNUMBER, e.emp_name, e.designation, e.shop_code, s.shop_name,
          COUNT(*) AS sick_count, MAX(r.sick_date) AS last_sick_date
        FROM sick_fit_records r JOIN employees e ON r.EMISCARDNUMBER=e.EMISCARDNUMBER
        LEFT JOIN shops s ON e.shop_code=s.shop_code
        WHERE r.sick_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) ${shopFilter}
        GROUP BY r.EMISCARDNUMBER, e.emp_name, e.designation, e.shop_code, s.shop_name
        HAVING sick_count >= 2 ORDER BY sick_count DESC
      `, p);
      return res.json({ success: true, data: { new_cases: newCases, recovered, pending_followup: pending, recurring_cases: recurring, summary: { new_count: newCases.length, recovered_count: recovered.length, pending_count: pending.length, recurring_count: recurring.length } } });
    }
    // Mock
    const newCases = mock.employees.slice(0, 3).map(e => ({ ...e, status: 'Sick', sick_date: new Date().toISOString().split('T')[0], fit_date: null, days_count: 2, diagnosis: 'Fever', reporting_doctor: 'Dr. Ramachandran' }));
    const recovered = mock.employees.slice(3, 5).map(e => ({ ...e, status: 'Fit', sick_date: '2026-05-10', fit_date: new Date().toISOString().split('T')[0], days_count: 7 }));
    const pending = mock.employees.slice(5, 7).map(e => ({ ...e, status: 'Sick', sick_date: '2026-05-01', fit_date: null, days_pending: 17 }));
    const recurring = mock.employees.slice(0, 2).map(e => ({ ...e, sick_count: 3, last_sick_date: '2026-05-10' }));
    res.json({ success: true, data: { new_cases: newCases, recovered, pending_followup: pending, recurring_cases: recurring, summary: { new_count: newCases.length, recovered_count: recovered.length, pending_count: pending.length, recurring_count: recurring.length } } });
  } catch(err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.get('/contacts', authenticateToken, async (req, res) => {
  try {
    const { shop_code } = req.query;
    if (await isDbAvailable()) {
      let shopFilter = shop_code ? 'WHERE c.shop_code=?' : '';
      const p = shop_code ? [shop_code] : [];
      // Return one contact per employee (distinct EMISCARDNUMBER), limit 200
      const [rows] = await pool.execute(`
        SELECT
          c.contact_id, c.sse_name, c.EMISCARDNUMBER,
          c.cug_number, c.designation, c.shop_code,
          c.department, s.shop_name,
          (SELECT COUNT(*) FROM sick_fit_records r
           WHERE r.EMISCARDNUMBER=c.EMISCARDNUMBER
             AND r.fit_date IS NULL AND r.status='Sick') AS current_sick_count
        FROM (
          SELECT MIN(contact_id) AS contact_id, EMISCARDNUMBER,
                 MIN(sse_name) AS sse_name, MIN(cug_number) AS cug_number,
                 MIN(designation) AS designation, MIN(shop_code) AS shop_code,
                 MIN(department) AS department
          FROM cug_contacts
          WHERE is_active=1
          GROUP BY EMISCARDNUMBER
          LIMIT 200
        ) c
        LEFT JOIN shops s ON c.shop_code = s.shop_code
        ${shopFilter}
        ORDER BY c.sse_name
      `, p);
      return res.json({ success: true, data: rows });
    }
    let data = mock.sseContacts;
    if (shop_code) data = data.filter(c => c.shop_code === shop_code);
    res.json({ success: true, data });
  } catch(err) {
    console.error('SSE contacts error:', err.message);
    res.json({ success: true, data: [] });
  }
});

// GET /api/sse-monitoring/employees
router.get('/employees', authenticateToken, async (req, res) => {
  try {
    const { shop_code } = req.query;
    if (!shop_code) {
      return res.status(400).json({ success: false, message: 'shop_code is required' });
    }

    if (await isDbAvailable()) {
      const [rows] = await pool.execute(`
        SELECT 
          e.EMISCARDNUMBER,
          e.emp_name,
          e.designation,
          e.category,
          r.status,
          r.sick_date,
          r.fit_date,
          r.days_count,
          r.diagnosis,
          r.reporting_doctor,
          r.hospital_name
        FROM employees e
        JOIN sick_fit_records r ON e.EMISCARDNUMBER = r.EMISCARDNUMBER
        WHERE e.shop_code = ?
        ORDER BY r.status DESC, r.sick_date DESC
      `, [shop_code]);

      return res.json({ success: true, data: rows });
    }
    res.json({ success: true, data: [] });
  } catch(err) {
    console.error('SSE employees list error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
