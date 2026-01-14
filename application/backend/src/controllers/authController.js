const bcrypt = require('bcrypt');
const { pool } = require('../config/db');

/**
 * Register a new user (student only - all users start as students)
 */
const register = async (req, res) => {
  const { firstName, lastName, email, password, studentProfile } = req.body;

  // Validate input
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'All required fields must be provided'
    });
  }

  // Trim whitespace from inputs
  firstName = firstName.trim();
  lastName = lastName.trim();
  email = email.trim().toLowerCase(); // Normalize email to lowercase
  password = password.trim();

  // Validate that fields aren't empty after trimming
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'All required fields must be provided'
    });
  }

  // Validate SFSU email domain
  const validEmailPattern = /^[A-Za-z0-9._%+-]+@(sfsu\.edu|mail\.sfsu\.edu)$/;
  if (!validEmailPattern.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Email must be a valid SFSU email address (@sfsu.edu or @mail.sfsu.edu)'
    });
  }

  // Validate email length (prevent buffer overflow)
  if (email.length > 255) {
    return res.status(400).json({
      success: false,
      message: 'Email must be 255 characters or less'
    });
  }

  // Validate name lengths (prevent buffer overflow)
  if (firstName.length > 100 || lastName.length > 100) {
    return res.status(400).json({
      success: false,
      message: 'First name and last name must be 100 characters or less'
    });
  }

  // Validate password is not just whitespace
  if (password.replace(/\s/g, '').length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Password cannot be only whitespace'
    });
  }

  // Validate password length
  if (password.length < 6 || password.length > 255) {
    return res.status(400).json({
      success: false,
      message: 'Password must be between 6 and 255 characters'
    });
  }

  // Validate terms acceptance
  if (!req.body.termsAccepted) {
    return res.status(400).json({
      success: false,
      message: 'You must accept the terms and conditions to register'
    });
  }

  // All users register as students
  const role = 'Student';

  try {
    // Check if email already exists
    const [existingUsers] = await pool.query(
      'SELECT user_id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user into database
    const [result] = await pool.query(
      'INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES (?, ?, ?, ?, ?)',
      [email, passwordHash, firstName, lastName, role]
    );

    const userId = result.insertId;

    // Validate and sanitize student profile fields
    const profile = studentProfile || {};
    
    // Validate bio length
    if (profile.bio && profile.bio.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Bio must be 1000 characters or less'
      });
    }

    // Validate major length
    if (profile.major && profile.major.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Major must be 100 characters or less'
      });
    }

    // Validate GPA range
    if (profile.gpa !== null && profile.gpa !== undefined) {
      const gpaValue = parseFloat(profile.gpa);
      if (isNaN(gpaValue) || gpaValue < 0 || gpaValue > 4) {
        return res.status(400).json({
          success: false,
          message: 'GPA must be between 0.00 and 4.00'
        });
      }
    }

    // Create student profile with optional fields
    await pool.query(
      `INSERT INTO student_profiles
       (user_id, major, academic_level, gpa, expected_graduation_date, bio)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        profile.major || null,
        profile.academicLevel || null,
        profile.gpa || null,
        profile.graduationDate || null,
        profile.bio || null
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: {
        userId,
        email,
        firstName,
        lastName,
        role
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.'
    });
  }
};

/**
 * Login user and create session
 */
const login = async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
  }

  // Validate email format (basic check)
  if (email.length > 255 || password.length > 255) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email or password'
    });
  }

  try {
    // Get user with role information
    const [users] = await pool.query(
      `SELECT user_id, email, password_hash, first_name, last_name, role
       FROM users
       WHERE email = ?`,
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = users[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Create session
    req.session.userId = user.user_id;
    req.session.email = user.email;
    req.session.role = user.role;
    req.session.firstName = user.first_name;
    req.session.lastName = user.last_name;

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        userId: user.user_id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.'
    });
  }
};

/**
 * Logout user and destroy session
 */
const logout = async (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Logout failed'
      });
    }

    res.clearCookie('connect.sid');
    return res.status(200).json({
      success: true,
      message: 'Logout successful'
    });
  });
};

/**
 * Get current user - fetches fresh role from database
 * This ensures role changes (e.g., Student -> Tutor) are reflected immediately
 */
const getCurrentUser = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    // Fetch current role from database (in case it was changed by admin)
    const [users] = await pool.query(
      'SELECT role FROM users WHERE user_id = ?',
      [req.session.userId]
    );

    if (users.length === 0) {
      // User no longer exists - clear session
      req.session.destroy();
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentRole = users[0].role;

    // Update session if role changed
    if (req.session.role !== currentRole) {
      req.session.role = currentRole;
    }

    return res.status(200).json({
      success: true,
      user: {
        userId: req.session.userId,
        email: req.session.email,
        firstName: req.session.firstName,
        lastName: req.session.lastName,
        role: currentRole
      }
    });
  } catch (error) {
    console.error('Error fetching current user:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch user data'
    });
  }
};

module.exports = {
  register,
  login,
  logout,
  getCurrentUser
};
