const { pool } = require('../config/db');

exports.getSubjects = async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT s.subject_id AS id, s.name
      FROM subjects s
      INNER JOIN tutor_subjects ts ON s.subject_id = ts.subject_id
      INNER JOIN tutor_profiles tp ON ts.tutor_user_id = tp.user_id
      WHERE tp.verification_status = 'verified'
      ORDER BY s.name ASC
    `;

    const [rows] = await pool.execute(query);
    res.json(rows);
  } catch (error) {
    console.error('Database error fetching subjects:', error.message);
    res.status(500).json({
      error: 'Failed to fetch subjects',
      message: error.message,
    });
  }
};

exports.getDepartments = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const noSpaces = q.replace(/\s+/g, '').toLowerCase();

    let query = `
      SELECT DISTINCT
        d.department_id AS id,
        d.code AS department_code,
        d.name AS department_name,
        c.course_title
      FROM departments d
      INNER JOIN courses c        ON c.department_id = d.department_id
      INNER JOIN tutor_courses tc ON c.course_id = tc.course_id
      INNER JOIN tutor_profiles tp ON tc.tutor_user_id = tp.user_id
      WHERE tp.verification_status = 'verified'
    `;

    const params = [];

    if (q) {
      query += ` AND (
        d.code LIKE ? OR
        d.name LIKE ? OR
        c.course_title LIKE ? OR
        REPLACE(c.course_title, ' ', '') LIKE ?
      )`;

      const like = `%${q}%`;
      const likeNoSpaces = `%${noSpaces}%`;
      params.push(like, like, like, likeNoSpaces);
    }

    query += `
      ORDER BY d.code ASC, c.course_title ASC
    `;

    const [rows] = await pool.execute(query, params);

    // Group courses under each department
    const map = {};
    for (const row of rows) {
      if (!map[row.id]) {
        map[row.id] = {
          department_id: row.id,
          department_code: row.department_code,
          department_name: row.department_name,
          courses: [],
        };
      }
      if (row.course_title) {
        map[row.id].courses.push(row.course_title);
      }
    }

    res.json(Object.values(map));
  } catch (error) {
    console.error('Database error fetching departments:', error.message);
    res.status(500).json({
      error: 'Failed to fetch departments',
      message: error.message,
    });
  }
};

exports.getCourses = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();

    let query = `
      SELECT DISTINCT
        c.course_id AS id,
        c.course_title,
        d.code AS department_code,
        d.name AS department_name
      FROM courses c
      INNER JOIN departments d      ON c.department_id = d.department_id
      INNER JOIN tutor_courses tc   ON c.course_id = tc.course_id
      INNER JOIN tutor_profiles tp  ON tc.tutor_user_id = tp.user_id
      WHERE tp.verification_status = 'verified'
    `;

    const params = [];

    if (q) {
      const lower = q.toLowerCase();

      // crude helper: map "1/2/3" → " i/ii/iii" for typical Calc I/II/III style names
      let romanized = lower;
      romanized = romanized.replace(/\b1\b/g, ' i');
      romanized = romanized.replace(/\b2\b/g, ' ii');
      romanized = romanized.replace(/\b3\b/g, ' iii');

      query += ` AND (
        LOWER(c.course_title) LIKE ? OR
        LOWER(c.course_title) LIKE ?
      )`;

      params.push(`%${lower}%`, `%${romanized}%`);
    }

    query += `
      ORDER BY d.code ASC, c.course_title ASC
    `;

    const [rows] = await pool.execute(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Database error fetching courses:', error.message);
    res.status(500).json({
      error: 'Failed to fetch courses',
      message: error.message,
    });
  }
};

exports.search = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const department = (req.query.department || '').trim();
    const minRating = parseFloat(req.query.minRating || '0');
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';
    const noSpacesQ = q.replace(/\s+/g, '').toLowerCase();

    // ===== SEARCH SESSIONS =====
    let sessionQuery = `
      SELECT DISTINCT
        sess.session_id,
        sess.title,
        sess.start_time,
        sess.end_time,
        sess.session_type,
        sess.capacity,
        sess.location_details,
        sess.status,
        CONCAT(u.first_name, ' ', u.last_name) AS tutor_name,
        u.user_id AS tutor_id,
        COALESCE(tr.rating_avg, 0) AS tutor_rating,
        GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') AS subjects,
        SUBSTRING_INDEX(
          GROUP_CONCAT(
            DISTINCT CONCAT(d.code, ' ', c.course_number)
            ORDER BY d.code, c.course_number
            SEPARATOR ', '
          ),
          ', ',
          3
        ) AS courses,
        (SELECT COUNT(*) FROM session_attendees sa WHERE sa.session_id = sess.session_id) AS enrolled_count
      FROM sessions sess
      INNER JOIN users u           ON sess.tutor_id = u.user_id
      INNER JOIN tutor_profiles tp ON u.user_id = tp.user_id
      LEFT JOIN tutor_ratings tr   ON u.user_id = tr.tutor_user_id
      LEFT JOIN tutor_subjects ts  ON u.user_id = ts.tutor_user_id
      LEFT JOIN subjects s         ON ts.subject_id = s.subject_id
      LEFT JOIN session_courses sc ON sess.session_id = sc.session_id
      LEFT JOIN courses c          ON sc.course_id = c.course_id
      LEFT JOIN departments d      ON c.department_id = d.department_id
      WHERE tp.verification_status = 'verified'
        AND sess.status IN ('scheduled', 'active')
        AND DATE(sess.start_time) >= CURDATE()
    `;

    const sessionParams = [];

    if (q) {
      sessionQuery += ` AND (
        CONCAT(u.first_name, ' ', u.last_name) LIKE ? OR
        sess.title LIKE ? OR
        d.code LIKE ? OR
        c.course_number LIKE ? OR
        CONCAT(d.code, ' ', c.course_number) LIKE ? OR
        CONCAT(d.code, c.course_number) LIKE ?
      )`;

      const like = `%${q}%`;
      const likeNoSpaces = `%${noSpacesQ}%`;
      sessionParams.push(like, like, like, like, like, likeNoSpaces);
    }

    if (department) {
      sessionQuery += ` AND d.code LIKE ?`;
      sessionParams.push(`%${department}%`);
    }

    if (!Number.isNaN(minRating) && minRating > 0) {
      sessionQuery += ` AND COALESCE(tr.rating_avg, 0) >= ?`;
      sessionParams.push(minRating);
    }

    if (startDate) {
      sessionQuery += ` AND DATE(sess.start_time) >= ?`;
      sessionParams.push(startDate);
    }

    if (endDate) {
      sessionQuery += ` AND DATE(sess.end_time) <= ?`;
      sessionParams.push(endDate);
    }

    sessionQuery += `
      GROUP BY
        sess.session_id,
        sess.title,
        sess.start_time,
        sess.end_time,
        sess.session_type,
        sess.capacity,
        sess.location_details,
        sess.status,
        u.user_id,
        u.first_name,
        u.last_name,
        tr.rating_avg
      HAVING (SELECT COUNT(*) FROM session_attendees sa WHERE sa.session_id = sess.session_id) < sess.capacity
      ORDER BY sess.start_time ASC
    `;

    // ===== SEARCH TUTORS =====
    let tutorQuery = `
      SELECT DISTINCT
        u.user_id AS id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        tp.description AS bio,
        COALESCE(tr.rating_avg, 0) AS rating,
        GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') AS subjects,
        SUBSTRING_INDEX(
          GROUP_CONCAT(
            DISTINCT CONCAT(d.code, ' ', c.course_number)
            ORDER BY d.code, c.course_number
            SEPARATOR ', '
          ),
          ', ',
          3
        ) AS courses
      FROM users u
      INNER JOIN tutor_profiles tp ON u.user_id = tp.user_id
      LEFT JOIN tutor_ratings tr   ON u.user_id = tr.tutor_user_id
      LEFT JOIN tutor_subjects ts  ON u.user_id = ts.tutor_user_id
      LEFT JOIN subjects s         ON ts.subject_id = s.subject_id
      LEFT JOIN tutor_courses tc   ON u.user_id = tc.tutor_user_id
      LEFT JOIN courses c          ON tc.course_id = c.course_id
      LEFT JOIN departments d      ON c.department_id = d.department_id
      WHERE tp.verification_status = 'verified'
    `;

    const tutorParams = [];

    if (q) {
      tutorQuery += ` AND (
        CONCAT(u.first_name, ' ', u.last_name) LIKE ? OR
        tp.description LIKE ? OR
        d.code LIKE ? OR
        c.course_number LIKE ? OR
        CONCAT(d.code, ' ', c.course_number) LIKE ? OR
        CONCAT(d.code, c.course_number) LIKE ?
      )`;

      const like = `%${q}%`;
      const likeNoSpaces = `%${noSpacesQ}%`;
      tutorParams.push(like, like, like, like, like, likeNoSpaces);
    }

    if (department) {
      tutorQuery += ` AND d.code LIKE ?`;
      tutorParams.push(`%${department}%`);
    }

    if (!Number.isNaN(minRating) && minRating > 0) {
      tutorQuery += ` AND COALESCE(tr.rating_avg, 0) >= ?`;
      tutorParams.push(minRating);
    }

    tutorQuery += `
      GROUP BY
        u.user_id,
        u.first_name,
        u.last_name,
        tp.description,
        tr.rating_avg
      ORDER BY rating DESC
    `;

    const [sessionRows] = await pool.execute(sessionQuery, sessionParams);
    const [tutorRows] = await pool.execute(tutorQuery, tutorParams);

    const sessions = sessionRows.map((row) => ({
      session_id: row.session_id,
      title: row.title || 'Tutoring Session',
      start_time: row.start_time,
      end_time: row.end_time,
      session_type: row.session_type,
      capacity: row.capacity,
      location_details: row.location_details,
      status: row.status,
      tutor_name: row.tutor_name,
      tutor_id: row.tutor_id,
      tutor_rating: parseFloat(row.tutor_rating) || 0,
      subjects: row.subjects ? row.subjects.split(', ').filter(Boolean) : [],
      courses: row.courses ? row.courses.split(', ').filter(Boolean) : [],
    }));

    const tutors = tutorRows.map((row) => ({
      id: row.id,
      name: row.name,
      rating: parseFloat(row.rating) || 0,
      bio: row.bio || '',
      subjects: row.subjects ? row.subjects.split(', ').filter(Boolean) : [],
      courses: row.courses ? row.courses.split(', ').filter(Boolean) : [],
    }));

    res.json({
      sessions: {
        count: sessions.length,
        results: sessions,
      },
      tutors: {
        count: tutors.length,
        results: tutors,
      },
    });
  } catch (error) {
    console.error('Database error:', error.message);
    res.status(500).json({
      error: 'Database query failed',
      message: error.message,
    });
  }
};

exports.getSessionById = async (req, res) => {
  try {
    const sessionId = req.params.id;

    if (!sessionId || isNaN(parseInt(sessionId))) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    const query = `
      SELECT
        sess.session_id,
        sess.title,
        sess.start_time,
        sess.end_time,
        sess.session_type,
        sess.capacity,
        sess.location_details,
        sess.status,
        CONCAT(u.first_name, ' ', u.last_name) AS tutor_name,
        u.user_id AS tutor_id,
        COALESCE(tr.rating_avg, 0) AS tutor_rating,
        GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') AS subjects,
        GROUP_CONCAT(
          DISTINCT CONCAT(d.code, ' ', c.course_number)
          ORDER BY d.code, c.course_number
          SEPARATOR ', '
        ) AS courses
      FROM sessions sess
      INNER JOIN users u           ON sess.tutor_id = u.user_id
      INNER JOIN tutor_profiles tp ON u.user_id = tp.user_id
      LEFT JOIN tutor_ratings tr   ON u.user_id = tr.tutor_user_id
      LEFT JOIN tutor_subjects ts  ON u.user_id = ts.tutor_user_id
      LEFT JOIN subjects s         ON ts.subject_id = s.subject_id
      LEFT JOIN session_courses sc ON sess.session_id = sc.session_id
      LEFT JOIN courses c          ON sc.course_id = c.course_id
      LEFT JOIN departments d      ON c.department_id = d.department_id
      WHERE sess.session_id = ?
      GROUP BY
        sess.session_id,
        sess.title,
        sess.start_time,
        sess.end_time,
        sess.session_type,
        sess.capacity,
        sess.location_details,
        sess.status,
        u.user_id,
        u.first_name,
        u.last_name,
        tr.rating_avg
    `;

    const [rows] = await pool.execute(query, [sessionId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const row = rows[0];

    // Get current enrollment count from session_attendees
    const [attendeeRows] = await pool.execute(
      'SELECT COUNT(*) AS enrolled FROM session_attendees WHERE session_id = ?',
      [sessionId]
    );
    const enrolled = attendeeRows[0]?.enrolled || 0;

    // Calculate duration in minutes
    const startTime = new Date(row.start_time);
    const endTime = new Date(row.end_time);
    const duration = Math.round((endTime - startTime) / (1000 * 60));

    const session = {
      id: row.session_id,
      tutor: row.tutor_name,
      tutorId: row.tutor_id,
      tutorRating: parseFloat(row.tutor_rating) || 0,
      date: startTime.toISOString().split('T')[0],
      time: startTime.toTimeString().slice(0, 5),
      duration: duration,
      type: row.session_type,
      subject: row.title || 'Tutoring Session',
      subjects: row.subjects ? row.subjects.split(', ').filter(Boolean) : [],
      courses: row.courses ? row.courses.split(', ').filter(Boolean) : [],
      location: row.location_details || 'TBD',
      capacity: row.capacity,
      enrolled: enrolled,
      status: row.status,
    };

    res.json(session);
  } catch (error) {
    console.error('Database error fetching session:', error.message);
    res.status(500).json({
      error: 'Failed to fetch session',
      message: error.message,
    });
  }
};