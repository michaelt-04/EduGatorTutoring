const { pool } = require('../config/db');

/**
 * Submit a tutor application
 * Creates a tutor_profiles record with verification_status = 'pending'
 */
const applyToBeTutor = async (req, res) => {
  // Check if user is logged in
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in to apply'
    });
  }

  const userId = req.session.userId;
  const { yearsExperience, description, bio } = req.body;

  // Validate required fields
  if (yearsExperience === undefined || !description || !bio) {
    return res.status(400).json({
      success: false,
      message: 'Years of experience, description, and bio are required'
    });
  }

  try {
    // Check if user is already a tutor
    const [existingUser] = await pool.query(
      'SELECT role FROM users WHERE user_id = ?',
      [userId]
    );

    if (existingUser.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (existingUser[0].role === 'Tutor') {
      return res.status(400).json({
        success: false,
        message: 'You are already a tutor'
      });
    }

    // Check if user already has a pending or rejected application
    const [existingApplication] = await pool.query(
      'SELECT verification_status FROM tutor_profiles WHERE user_id = ?',
      [userId]
    );

    if (existingApplication.length > 0) {
      const status = existingApplication[0].verification_status;
      if (status === 'pending') {
        return res.status(400).json({
          success: false,
          message: 'You already have a pending application'
        });
      }
      if (status === 'verified') {
        return res.status(400).json({
          success: false,
          message: 'Your application has already been approved'
        });
      }
      // If rejected, allow them to update their application
      await pool.query(
        `UPDATE tutor_profiles
         SET years_experience = ?, description = ?, bio = ?, verification_status = 'pending'
         WHERE user_id = ?`,
        [yearsExperience, description, bio, userId]
      );

      return res.status(200).json({
        success: true,
        message: 'Your application has been resubmitted for review'
      });
    }

    // Create new tutor profile with pending status
    await pool.query(
      `INSERT INTO tutor_profiles (user_id, years_experience, hourly_rate, description, bio, verification_status)
       VALUES (?, ?, 0, ?, ?, 'pending')`,
      [userId, yearsExperience, description, bio]
    );

    return res.status(201).json({
      success: true,
      message: 'Your tutor application has been submitted successfully'
    });

  } catch (error) {
    console.error('Error submitting tutor application:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit application. Please try again.'
    });
  }
};

/**
 * Get current user's application status
 */
const getApplicationStatus = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  const userId = req.session.userId;

  try {
    const [application] = await pool.query(
      `SELECT verification_status, years_experience, hourly_rate, description, bio
       FROM tutor_profiles WHERE user_id = ?`,
      [userId]
    );

    if (application.length === 0) {
      return res.status(200).json({
        success: true,
        hasApplication: false,
        status: null
      });
    }

    return res.status(200).json({
      success: true,
      hasApplication: true,
      status: application[0].verification_status,
      application: application[0]
    });

  } catch (error) {
    console.error('Error fetching application status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch application status'
    });
  }
};


/**
 * Add a course to tutor's offerings
 */
const addTutorCourse = async (req, res) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    const { title, code, credits, description } = req.body;

    // Validate required fields
    if (!title || !code) {
      return res.status(400).json({
        success: false,
        message: 'Course title and code are required'
      });
    }

    // Verify user is a tutor
    const [tutorCheck] = await pool.query(
      'SELECT user_id FROM tutor_profiles WHERE user_id = ?',
      [userId]
    );

    if (tutorCheck.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'User is not a tutor'
      });
    }

    // Parse department code (e.g., "CSC 415" -> "CSC")
    const departmentCode = code.split(' ')[0].toUpperCase();
    // Parse course number (e.g., "CSC 415" -> "415")
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
      'PSYC': 'Psychology',
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
      // Create new department if it doesn't exist
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
      // Create new course
      const [result] = await pool.query(
        'INSERT INTO courses (department_id, course_number, course_title, description) VALUES (?, ?, ?, ?)',
        [departmentId, courseNumber, title, description || null]
      );
      courseId = result.insertId;
    } else {
      courseId = courses[0].course_id;
    }

    // Check if tutor already teaches this course
    const [existingMapping] = await pool.query(
      'SELECT * FROM tutor_courses WHERE tutor_user_id = ? AND course_id = ?',
      [userId, courseId]
    );

    if (existingMapping.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'You are already offering tutoring for this course'
      });
    }

    // Add course to tutor's offerings
    await pool.query(
      'INSERT INTO tutor_courses (tutor_user_id, course_id) VALUES (?, ?)',
      [userId, courseId]
    );

    return res.status(201).json({
      success: true,
      message: 'Course added successfully',
      data: {
        courseId,
        title,
        code,
        credits,
        description
      }
    });

  } catch (error) {
    console.error('Error adding tutor course:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add course'
    });
  }
};

/**
 * Remove a course from tutor's offerings
 */
const removeTutorCourse = async (req, res) => {
  const userId = req.session?.userId;
  const { courseId } = req.params;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    // Delete the mapping
    const [result] = await pool.query(
      'DELETE FROM tutor_courses WHERE tutor_user_id = ? AND course_id = ?',
      [userId, courseId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Course not found in your offerings'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Course removed successfully'
    });

  } catch (error) {
    console.error('Error removing tutor course:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove course'
    });
  }
};

module.exports = {
  applyToBeTutor,
  getApplicationStatus,
  addTutorCourse,
  removeTutorCourse
};
