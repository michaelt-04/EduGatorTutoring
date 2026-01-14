// controllers/tutorProfileController.js
const { pool } = require('../config/db');

// GET /api/tutors/:id
// Returns a single tutor profile in the shape expected by tutorProfile.html
// GET /api/tutors/:id
// Returns a single tutor profile in the shape expected by tutorProfile.html
exports.getTutorProfile = async (req, res) => {
  try {
    const tutorId = parseInt(req.params.id, 10);
    if (Number.isNaN(tutorId)) {
      return res.status(400).json({ error: 'Invalid tutor ID' });
    }

    const [rows] = await pool.execute(
      `
      SELECT
        u.user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        COALESCE(tr.rating_avg, 0)           AS rating,
        COALESCE(tp.years_experience, 0)     AS years_experience,
        tp.verification_status,
        tp.bio,
        f.url                                AS profile_picture,
        GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ',') AS subjects
      FROM users u
      INNER JOIN tutor_profiles tp ON tp.user_id = u.user_id
      LEFT JOIN tutor_ratings tr   ON tr.tutor_user_id = u.user_id
      LEFT JOIN tutor_subjects ts  ON ts.tutor_user_id = u.user_id
      LEFT JOIN subjects s         ON s.subject_id = ts.subject_id
      LEFT JOIN files f            ON f.file_id = u.profile_file_id
      WHERE u.user_id = ?
      GROUP BY
        u.user_id,
        u.first_name,
        u.last_name,
        tr.rating_avg,
        tp.years_experience,
        tp.verification_status,
        tp.bio,
        f.url
      `,
      [tutorId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    const row = rows[0];

    // Fetch tutor's courses
    const [courseRows] = await pool.execute(
      `
      SELECT
        c.course_id,
        c.course_title,
        c.course_number,
        d.code AS department_code,
        c.description,
        c.credits
      FROM tutor_courses tc
      INNER JOIN courses c ON tc.course_id = c.course_id
      INNER JOIN departments d ON c.department_id = d.department_id
      WHERE tc.tutor_user_id = ?
      ORDER BY d.code, c.course_number
      `,
      [tutorId]
    );

    const courses = courseRows.map(course => ({
      course_id: course.course_id,
      title: course.course_title,
      code: `${course.department_code} ${course.course_number}`,
      description: course.description,
      credits: course.credits
    }));

    const profile = {
      name: row.name,
      rating: Number(row.rating) || 0,
      years_experience: Number(row.years_experience) || 0,
      verification_status: row.verification_status,
      bio: row.bio || '',
      profile_picture: row.profile_picture || null,
      subjects: row.subjects
        ? row.subjects.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      courses: courses  // Add courses to the response
    };

    res.json(profile);
  } catch (error) {
    console.error('Database error fetching tutor profile:', error.message);
    res.status(500).json({
      error: 'Failed to fetch tutor profile',
      message: error.message,
    });
  }
};

// GET /api/tutors/:id/sessions
// Returns upcoming sessions for a tutor in the shape expected by tutorProfile.html
exports.getTutorSessions = async (req, res) => {
  try {
    const tutorId = parseInt(req.params.id, 10);
    if (Number.isNaN(tutorId)) {
      return res.status(400).json({ error: 'Invalid tutor ID' });
    }

    const [rows] = await pool.execute(
      `
      SELECT
        sess.session_id,
        sess.title,
        sess.session_type,
        sess.start_time,
        sess.end_time,
        sess.capacity,
        sess.location_details,
        GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ',') AS subjects,
        (SELECT COUNT(*) FROM session_attendees sa WHERE sa.session_id = sess.session_id) AS enrolled_count
      FROM sessions sess
      INNER JOIN users u           ON sess.tutor_id = u.user_id
      INNER JOIN tutor_profiles tp ON tp.user_id = u.user_id
      LEFT JOIN tutor_subjects ts  ON ts.tutor_user_id = u.user_id
      LEFT JOIN subjects s         ON s.subject_id = ts.subject_id
      WHERE
        sess.tutor_id = ?
        AND tp.verification_status = 'verified'
        AND sess.status IN ('scheduled', 'active')
        AND sess.start_time >= NOW()
      GROUP BY
        sess.session_id,
        sess.title,
        sess.session_type,
        sess.start_time,
        sess.end_time,
        sess.capacity,
        sess.location_details
      ORDER BY sess.start_time ASC
      `,
      [tutorId]
    );

    const sessions = rows.map(row => ({
      session_id: row.session_id,
      title: row.title || 'Tutoring Session',
      session_type: row.session_type,
      start_time: row.start_time,
      end_time: row.end_time,
      capacity: row.capacity,
      enrolled_count: Number(row.enrolled_count) || 0,
      location_details: row.location_details,
      subjects: row.subjects
        ? row.subjects.split(',').map(s => s.trim()).filter(Boolean)
        : []
    }));

    res.json(sessions);
  } catch (error) {
    console.error('Database error fetching tutor sessions:', error.message);
    res.status(500).json({
      error: 'Failed to fetch tutor sessions',
      message: error.message,
    });
  }
};

// GET /api/tutors/:id/reviews
// Returns an array of reviews { student_name, created_at, rating, comment }
exports.getTutorReviews = async (req, res) => {
  try {
    const tutorId = parseInt(req.params.id, 10);
    if (Number.isNaN(tutorId)) {
      return res.status(400).json({ error: 'Invalid tutor ID' });
    }

    const [rows] = await pool.execute(
      `
      SELECT
        CONCAT(su.first_name, ' ', su.last_name) AS student_name,
        r.created_at,
        r.rating,
        r.comment
      FROM reviews r
      LEFT JOIN users su ON r.student_id = su.user_id
      WHERE r.tutor_id = ?
      ORDER BY r.created_at DESC
      `,
      [tutorId]
    );

    const reviews = rows.map(row => ({
      student_name: row.student_name,
      created_at: row.created_at,
      rating: Number(row.rating) || 0,
      comment: row.comment || ''
    }));

    res.json(reviews);
  } catch (error) {
    console.error('Database error fetching tutor reviews:', error.message);
    res.status(500).json({
      error: 'Failed to fetch tutor reviews',
      message: error.message,
    });
  }
};
