const { pool } = require('../config/db');

/**
 * Get student dashboard data
 */
const getStudentDashboard = async (req, res) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    // Get user and student profile
    const [userRows] = await pool.query(
      `SELECT
        u.user_id,
        u.email,
        u.first_name,
        u.last_name,
        u.role,
        u.profile_file_id,
        sp.major,
        sp.academic_level,
        sp.gpa,
        sp.expected_graduation_date,
        sp.bio
      FROM users u
      LEFT JOIN student_profiles sp ON u.user_id = sp.user_id
      WHERE u.user_id = ? AND u.role = 'Student'`,
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    const student = userRows[0];

    // Get student courses with department codes
    const [courses] = await pool.query(
      `SELECT
        c.course_id,
        c.course_title,
        c.course_number,
        c.credits,
        d.code AS department_code,
        sc.status,
        sc.term_label,
        sc.instructor_name,
        sc.schedule_text
      FROM student_courses sc
      JOIN courses c ON sc.course_id = c.course_id
      JOIN departments d ON c.department_id = d.department_id
      WHERE sc.student_user_id = ?
      ORDER BY
        CASE sc.status
          WHEN 'current' THEN 1
          WHEN 'planned' THEN 2
          WHEN 'completed' THEN 3
        END,
        sc.added_at DESC`,
      [userId]
    );

    // Calculate stats
    const currentCourses = courses.filter(c => c.status === 'current');
    const totalCredits = currentCourses.reduce((sum, c) => sum + (c.credits || 0), 0);

    // Get tutoring sessions attended count
    const [sessionStats] = await pool.query(
      `SELECT COUNT(DISTINCT sa.session_id) AS session_count
      FROM session_attendees sa
      WHERE sa.user_id = ?`,
      [userId]
    );

    const stats = {
      coursesEnrolled: currentCourses.length,
      totalCredits: totalCredits,
      tutoringSessions: sessionStats[0]?.session_count || 0
    };

    return res.status(200).json({
      success: true,
      data: {
        profile: {
          userId: student.user_id,
          email: student.email,
          firstName: student.first_name,
          lastName: student.last_name,
          major: student.major,
          academicLevel: student.academic_level,
          gpa: student.gpa ? parseFloat(student.gpa) : null,
          expectedGraduation: student.expected_graduation_date,
          bio: student.bio,
          profileFileId: student.profile_file_id
        },
        courses: courses.map(c => {
          // Use course_number from database, fallback to extracting from title
          const courseNumber = c.course_number || c.course_title.match(/(\d+)/)?.[1] || '';
          const code = courseNumber ? `${c.department_code} ${courseNumber}` : c.department_code;

          return {
            courseId: c.course_id,
            title: c.course_title,
            code: code,
            credits: c.credits,
            status: c.status,
            termLabel: c.term_label,
            instructor: c.instructor_name,
            schedule: c.schedule_text
          };
        }),
        stats
      }
    });

  } catch (error) {
    console.error('Error fetching student dashboard:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data'
    });
  }
};

/**
 * Get tutor dashboard data
 */
const getTutorDashboard = async (req, res) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    // Get user and tutor profile
    const [userRows] = await pool.query(
      `SELECT
        u.user_id,
        u.email,
        u.first_name,
        u.last_name,
        u.role,
        u.profile_file_id,
        u.created_at,
        tp.years_experience,
        tp.verification_status,
        tp.hourly_rate,
        tp.description,
        tp.bio,
        tp.resume_file_id,
        tr.rating_avg,
        tr.rating_count
      FROM users u
      LEFT JOIN tutor_profiles tp ON u.user_id = tp.user_id
      LEFT JOIN tutor_ratings tr ON u.user_id = tr.tutor_user_id
      WHERE u.user_id = ? AND u.role = 'Tutor'`,
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tutor not found'
      });
    }

    const tutor = userRows[0];

    // Get tutor courses with department codes
    const [courses] = await pool.query(
      `SELECT
        c.course_id,
        c.course_title,
        c.course_number,
        c.credits,
        d.code AS department_code
      FROM tutor_courses tc
      JOIN courses c ON tc.course_id = c.course_id
      JOIN departments d ON c.department_id = d.department_id
      WHERE tc.tutor_user_id = ?
      ORDER BY d.code, c.course_title`,
      [userId]
    );

    // Get tutor's sessions with course information
    const [sessions] = await pool.query(
      `SELECT
        s.session_id,
        s.title,
        s.start_time,
        s.end_time,
        s.session_type,
        s.capacity,
        s.location_details,
        s.status,
        s.created_at,
        COUNT(DISTINCT sa.user_id) AS enrolled_count,
        GROUP_CONCAT(
          DISTINCT CONCAT(d.code, ' ', c.course_number)
          ORDER BY d.code, c.course_number
          SEPARATOR ', '
        ) AS course_names,
        GROUP_CONCAT(
          DISTINCT c.course_id
          ORDER BY c.course_id
          SEPARATOR ','
        ) AS course_ids
      FROM sessions s
      LEFT JOIN session_attendees sa ON s.session_id = sa.session_id
      LEFT JOIN session_courses sc ON s.session_id = sc.session_id
      LEFT JOIN courses c ON sc.course_id = c.course_id
      LEFT JOIN departments d ON c.department_id = d.department_id
      WHERE s.tutor_id = ?
      GROUP BY s.session_id
      ORDER BY s.start_time DESC`,
      [userId]
    );

    // Calculate stats
    const coursesOffered = courses.length;
    const activeSessions = sessions.filter(s =>
      s.status === 'scheduled' || s.status === 'active'
    ).length;

    // Get unique students helped
    const [studentStats] = await pool.query(
      `SELECT COUNT(DISTINCT sa.user_id) AS student_count
      FROM sessions s
      JOIN session_attendees sa ON s.session_id = sa.session_id
      WHERE s.tutor_id = ?`,
      [userId]
    );

    const stats = {
      coursesOffered,
      activeSessions,
      studentsHelped: studentStats[0]?.student_count || 0,
      rating: tutor.rating_avg ? parseFloat(tutor.rating_avg).toFixed(1) : null,
      ratingCount: tutor.rating_count || 0
    };

    return res.status(200).json({
      success: true,
      data: {
        profile: {
          userId: tutor.user_id,
          email: tutor.email,
          firstName: tutor.first_name,
          lastName: tutor.last_name,
          yearsExperience: tutor.years_experience,
          verificationStatus: tutor.verification_status,
          hourlyRate: tutor.hourly_rate,
          description: tutor.description,
          bio: tutor.bio,
          profileFileId: tutor.profile_file_id,
          resumeFileId: tutor.resume_file_id,
          memberSince: tutor.created_at
        },
        courses: courses.map(c => {
          // Use course_number from database, fallback to extracting from title
          const courseNumber = c.course_number || c.course_title.match(/(\d+)/)?.[1] || '';
          const code = courseNumber ? `${c.department_code} ${courseNumber}` : c.department_code;

          return {
            courseId: c.course_id,
            title: c.course_title,
            code: code,
            credits: c.credits
          };
        }),
        sessions: sessions.map(s => ({
          sessionId: s.session_id,
          title: s.title,
          startTime: s.start_time,
          endTime: s.end_time,
          sessionType: s.session_type,
          capacity: s.capacity,
          locationDetails: s.location_details,
          status: s.status,
          enrolledCount: s.enrolled_count,
          createdAt: s.created_at,
          courseNames: s.course_names || 'No course assigned',
          courseIds: s.course_ids ? s.course_ids.split(',').map(id => parseInt(id)) : []
        })),
        stats
      }
    });

  } catch (error) {
    console.error('Error fetching tutor dashboard:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data'
    });
  }
};


/**
 * Add a course to student's enrolled courses
 */
const addStudentCourse = async (req, res) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    const { title, code, credits, instructor, schedule, termLabel, status } = req.body;

    // Validate required fields
    if (!title || !code) {
      return res.status(400).json({
        success: false,
        message: 'Course title and code are required'
      });
    }

    // Verify user is a student
    const [studentCheck] = await pool.query(
      'SELECT user_id FROM users WHERE user_id = ? AND role = "Student"',
      [userId]
    );

    if (studentCheck.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'User is not a student'
      });
    }

    // Parse department code (e.g., "CSC 415" -> "CSC")
    const departmentCode = code.split(' ')[0].toUpperCase();
    const courseNumber = code.split(' ')[1] || '000';

    // Map department codes to full names
    const departmentNames = {
      'CSC': 'Computer Science',
      'MATH': 'Mathematics',
      'PHYS': 'Physics',
      'CHEM': 'Chemistry',
      'BIOL': 'Biology',
      'ENG': 'Engineering',
      'ECON': 'Economics',
      'PSY': 'Psychology',
      'HIST': 'History',
      'ENGL': 'English',
      'ART': 'Art',
      'MUS': 'Music',
      'BUS': 'Business',
      'ACCT': 'Accounting',
      'FIN': 'Finance',
      'MGMT': 'Management',
      'MKTG': 'Marketing'
    };

    const departmentName = departmentNames[departmentCode] || departmentCode;

    // Get or create department
    let [departments] = await pool.query(
      'SELECT department_id FROM departments WHERE code = ?',
      [departmentCode]
    );

    let departmentId;
    if (departments.length === 0) {
      const [result] = await pool.query(
        'INSERT INTO departments (code, name) VALUES (?, ?)',
        [departmentCode, departmentName]
      );
      departmentId = result.insertId;
    } else {
      departmentId = departments[0].department_id;
    }

    // Check if course already exists (by department_id AND course_number - this is the unique constraint)
    let [courses] = await pool.query(
      'SELECT course_id FROM courses WHERE department_id = ? AND course_number = ?',
      [departmentId, courseNumber]
    );

    let courseId;
    if (courses.length === 0) {
      // Create new course with credits
      const [result] = await pool.query(
        'INSERT INTO courses (department_id, course_number, course_title, credits) VALUES (?, ?, ?, ?)',
        [departmentId, courseNumber, title, credits || null]
      );
      courseId = result.insertId;
    } else {
      courseId = courses[0].course_id;
      // Update credits if provided and course exists
      if (credits) {
        await pool.query(
          'UPDATE courses SET credits = ? WHERE course_id = ? AND (credits IS NULL OR credits = 0)',
          [credits, courseId]
        );
      }
    }

    // Check if student already enrolled in this course
    const [existingEnrollment] = await pool.query(
      'SELECT * FROM student_courses WHERE student_user_id = ? AND course_id = ?',
      [userId, courseId]
    );

    if (existingEnrollment.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'You are already enrolled in this course'
      });
    }

    // Add course to student's courses
    await pool.query(
      `INSERT INTO student_courses 
       (student_user_id, course_id, status, term_label, instructor_name, schedule_text) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, courseId, status || 'current', termLabel || null, instructor || null, schedule || null]
    );

    return res.status(201).json({
      success: true,
      message: 'Course added successfully',
      data: {
        courseId,
        title,
        code
      }
    });

  } catch (error) {
    console.error('Error adding student course:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add course'
    });
  }
};

/**
 * Remove a course from student's enrolled courses
 */
const removeStudentCourse = async (req, res) => {
  const userId = req.session?.userId;
  const { courseId } = req.params;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    // Delete the enrollment
    const [result] = await pool.query(
      'DELETE FROM student_courses WHERE student_user_id = ? AND course_id = ?',
      [userId, courseId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Course not found in your enrollment'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Course removed successfully'
    });

  } catch (error) {
    console.error('Error removing student course:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove course'
    });
  }
};

/**
 * Get student calendar data (courses + enrolled sessions)
 */
const getStudentCalendar = async (req, res) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    // Get student courses with schedule information
    const [courses] = await pool.query(
      `SELECT
        c.course_id,
        c.course_title,
        c.course_number,
        d.code AS department_code,
        sc.schedule_text,
        sc.status,
        sc.term_label
      FROM student_courses sc
      JOIN courses c ON sc.course_id = c.course_id
      JOIN departments d ON c.department_id = d.department_id
      WHERE sc.student_user_id = ? AND sc.status = 'current'
      ORDER BY sc.added_at DESC`,
      [userId]
    );

    // Get enrolled sessions with details
    const [sessions] = await pool.query(
      `SELECT
        s.session_id,
        s.title,
        s.start_time,
        s.end_time,
        s.session_type,
        s.location_details,
        s.status,
        u.first_name AS tutor_first_name,
        u.last_name AS tutor_last_name,
        GROUP_CONCAT(
          DISTINCT CONCAT(d.code, ' ', c.course_number)
          ORDER BY d.code, c.course_number
          SEPARATOR ', '
        ) AS course_names
      FROM session_attendees sa
      JOIN sessions s ON sa.session_id = s.session_id
      JOIN users u ON s.tutor_id = u.user_id
      LEFT JOIN session_courses sc ON s.session_id = sc.session_id
      LEFT JOIN courses c ON sc.course_id = c.course_id
      LEFT JOIN departments d ON c.department_id = d.department_id
      WHERE sa.user_id = ? AND s.status IN ('scheduled', 'active')
      GROUP BY s.session_id
      ORDER BY s.start_time ASC`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      data: {
        courses: courses.map(c => {
          const courseNumber = c.course_number || c.course_title.match(/(\d+)/)?.[1] || '';
          const code = courseNumber ? `${c.department_code} ${courseNumber}` : c.department_code;

          return {
            courseId: c.course_id,
            title: c.course_title,
            code: code,
            schedule: c.schedule_text,
            status: c.status,
            termLabel: c.term_label
          };
        }),
        sessions: sessions.map(s => ({
          sessionId: s.session_id,
          title: s.title,
          startTime: s.start_time,
          endTime: s.end_time,
          sessionType: s.session_type,
          location: s.location_details,
          status: s.status,
          tutorName: `${s.tutor_first_name} ${s.tutor_last_name}`,
          courseNames: s.course_names || 'No course assigned'
        }))
      }
    });

  } catch (error) {
    console.error('Error fetching student calendar:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch calendar data'
    });
  }
};

/**
 * Get tutor calendar data (created sessions)
 */
const getTutorCalendar = async (req, res) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    // Get tutor's created sessions with details
    const [sessions] = await pool.query(
      `SELECT
        s.session_id,
        s.title,
        s.start_time,
        s.end_time,
        s.session_type,
        s.capacity,
        s.location_details,
        s.status,
        COUNT(DISTINCT sa.user_id) AS enrolled_count,
        GROUP_CONCAT(
          DISTINCT CONCAT(d.code, ' ', c.course_number)
          ORDER BY d.code, c.course_number
          SEPARATOR ', '
        ) AS course_names
      FROM sessions s
      LEFT JOIN session_attendees sa ON s.session_id = sa.session_id
      LEFT JOIN session_courses sc ON s.session_id = sc.session_id
      LEFT JOIN courses c ON sc.course_id = c.course_id
      LEFT JOIN departments d ON c.department_id = d.department_id
      WHERE s.tutor_id = ? AND s.status IN ('scheduled', 'active')
      GROUP BY s.session_id
      ORDER BY s.start_time ASC`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      data: {
        sessions: sessions.map(s => ({
          sessionId: s.session_id,
          title: s.title,
          startTime: s.start_time,
          endTime: s.end_time,
          sessionType: s.session_type,
          capacity: s.capacity,
          location: s.location_details,
          status: s.status,
          enrolledCount: s.enrolled_count,
          courseNames: s.course_names || 'No course assigned'
        }))
      }
    });

  } catch (error) {
    console.error('Error fetching tutor calendar:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch calendar data'
    });
  }
};

/**
 * Update student profile
 */
const updateStudentProfile = async (req, res) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    const { firstName, lastName, major, gpa, graduationDate, bio } = req.body;

    // Validate required fields
    if (!firstName || !lastName) {
      return res.status(400).json({
        success: false,
        message: 'First name and last name are required'
      });
    }

    // Validate GPA if provided
    if (gpa !== null && gpa !== undefined && (gpa < 0 || gpa > 4)) {
      return res.status(400).json({
        success: false,
        message: 'GPA must be between 0.00 and 4.00'
      });
    }

    // Validate bio length
    if (bio && bio.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Bio must be 1000 characters or less'
      });
    }

    // Update user's basic info
    await pool.query(
      'UPDATE users SET first_name = ?, last_name = ? WHERE user_id = ?',
      [firstName, lastName, userId]
    );

    // Update or create student profile
    const [existingProfile] = await pool.query(
      'SELECT user_id FROM student_profiles WHERE user_id = ?',
      [userId]
    );

    if (existingProfile.length > 0) {
      // Update existing profile
      await pool.query(
        `UPDATE student_profiles 
         SET major = ?, gpa = ?, expected_graduation_date = ?, bio = ?
         WHERE user_id = ?`,
        [major || null, gpa || null, graduationDate || null, bio || null, userId]
      );
    } else {
      // Create new profile
      await pool.query(
        `INSERT INTO student_profiles (user_id, major, gpa, expected_graduation_date, bio)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, major || null, gpa || null, graduationDate || null, bio || null]
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Error updating student profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

/**
 * Update tutor profile
 */
const updateTutorProfile = async (req, res) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    const { firstName, lastName, yearsExperience, description, bio } = req.body;

    // Validate required fields
    if (!firstName || !lastName) {
      return res.status(400).json({
        success: false,
        message: 'First name and last name are required'
      });
    }

    // Validate years of experience if provided
    if (yearsExperience !== null && yearsExperience !== undefined) {
      const years = parseInt(yearsExperience);
      if (isNaN(years) || years < 0 || years > 50) {
        return res.status(400).json({
          success: false,
          message: 'Years of experience must be between 0 and 50'
        });
      }
    }

    // Validate bio length
    if (bio && bio.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Bio must be 1000 characters or less'
      });
    }

    // Validate description length
    if (description && description.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Description must be 200 characters or less'
      });
    }

    // Update user's basic info
    await pool.query(
      'UPDATE users SET first_name = ?, last_name = ? WHERE user_id = ?',
      [firstName, lastName, userId]
    );

    // Update tutor profile
    const [existingProfile] = await pool.query(
      'SELECT user_id FROM tutor_profiles WHERE user_id = ?',
      [userId]
    );

    if (existingProfile.length > 0) {
      // Update existing profile
      await pool.query(
        `UPDATE tutor_profiles 
         SET years_experience = ?, description = ?, bio = ?
         WHERE user_id = ?`,
        [yearsExperience || 0, description || null, bio || null, userId]
      );
    } else {
      return res.status(404).json({
        success: false,
        message: 'Tutor profile not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Error updating tutor profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

module.exports = {
  getStudentDashboard,
  getTutorDashboard,
  addStudentCourse,
  removeStudentCourse,
  getStudentCalendar,
  getTutorCalendar,
  updateStudentProfile,
  updateTutorProfile
};
