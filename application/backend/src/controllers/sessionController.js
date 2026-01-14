const { pool } = require('../config/db');

/**
 * Create a new tutoring session
 */
const createSession = async (req, res) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    const { title, sessionType, courseIds, startTime, endTime, capacity, locationDetails } = req.body;

    // Validate required fields
    if (!title || !sessionType || !courseIds || !startTime || !endTime || !capacity) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, sessionType, courseIds, startTime, endTime, and capacity are required'
      });
    }

    // Validate courseIds is an array
    if (!Array.isArray(courseIds) || courseIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one course must be selected'
      });
    }

    // Validate title length
    if (title.trim().length > 150) {
      return res.status(400).json({
        success: false,
        message: 'Session title must be 150 characters or less'
      });
    }

    // Validate session type
    if (!['open', 'one_on_one'].includes(sessionType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid session type. Must be "open" or "one_on_one"'
      });
    }

    // Verify user is a tutor
    const [tutorCheck] = await pool.query(
      'SELECT user_id FROM users WHERE user_id = ? AND role = "Tutor"',
      [userId]
    );

    if (tutorCheck.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Only tutors can create sessions'
      });
    }

    // Verify all courses exist and tutor is associated with them
    const placeholders = courseIds.map(() => '?').join(',');
    const [courseCheck] = await pool.query(
      `SELECT tc.course_id, c.course_title, c.course_number, d.code as department_code
       FROM tutor_courses tc
       JOIN courses c ON tc.course_id = c.course_id
       JOIN departments d ON c.department_id = d.department_id
       WHERE tc.tutor_user_id = ? AND tc.course_id IN (${placeholders})`,
      [userId, ...courseIds]
    );

    if (courseCheck.length !== courseIds.length) {
      return res.status(400).json({
        success: false,
        message: 'One or more courses not found or you are not registered to tutor them'
      });
    }

    // Validate times
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    const now = new Date();

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date/time format'
      });
    }

    if (startDate <= now) {
      return res.status(400).json({
        success: false,
        message: 'Session must be scheduled in the future'
      });
    }

    if (endDate <= startDate) {
      return res.status(400).json({
        success: false,
        message: 'End time must be after start time'
      });
    }

    // Validate capacity
    const capacityNum = parseInt(capacity);
    if (isNaN(capacityNum) || capacityNum < 1 || capacityNum > 50) {
      return res.status(400).json({
        success: false,
        message: 'Capacity must be between 1 and 50'
      });
    }

    // For one-on-one sessions, enforce capacity of 1
    const finalCapacity = sessionType === 'one_on_one' ? 1 : capacityNum;

    // Format datetime for MySQL - preserve the local time as-is (don't convert to UTC)
    // Input format is "YYYY-MM-DDTHH:mm:ss", we just need to replace T with space
    const formatDateForMySQL = (dateStr) => {
      return dateStr.replace('T', ' ');
    };

    // Create the session
    const [sessionResult] = await pool.query(
      `INSERT INTO sessions (tutor_id, title, start_time, end_time, session_type, capacity, location_details, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
      [
        userId,
        title.trim(),
        formatDateForMySQL(startTime),
        formatDateForMySQL(endTime),
        sessionType,
        finalCapacity,
        locationDetails || null
      ]
    );

    const sessionId = sessionResult.insertId;

    // Link the session to all selected courses
    const courseInserts = courseIds.map(courseId => [sessionId, courseId]);
    await pool.query(
      'INSERT INTO session_courses (session_id, course_id) VALUES ?',
      [courseInserts]
    );

    // Build course names string for response
    const courseNames = courseCheck.map(c => `${c.department_code} ${c.course_number}`).join(', ');

    return res.status(201).json({
      success: true,
      message: 'Session created successfully',
      data: {
        sessionId: sessionId,
        title: title.trim(),
        sessionType: sessionType,
        courseIds: courseIds,
        courseNames: courseNames,
        startTime: startTime,
        endTime: endTime,
        capacity: finalCapacity,
        locationDetails: locationDetails
      }
    });

  } catch (error) {
    console.error('Error creating session:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create session'
    });
  }
};

/**
 * Get a specific session by ID
 */
const getSessionById = async (req, res) => {
  const { id } = req.params;

  try {
    const [sessions] = await pool.query(
      `SELECT
        s.session_id,
        s.tutor_id,
        s.title,
        s.start_time,
        s.end_time,
        s.session_type,
        s.capacity,
        s.location_details,
        s.status,
        s.created_at,
        
        u.first_name as tutor_first_name,
        u.last_name as tutor_last_name,
        GROUP_CONCAT(DISTINCT CONCAT(d.code, ' ', c.course_number) SEPARATOR ', ') as course_names,
        COUNT(DISTINCT sa.user_id) as enrolled_count
      FROM sessions s
      JOIN users u ON s.tutor_id = u.user_id
      LEFT JOIN session_courses sc ON s.session_id = sc.session_id
      LEFT JOIN courses c ON sc.course_id = c.course_id
      LEFT JOIN departments d ON c.department_id = d.department_id
      LEFT JOIN session_attendees sa ON s.session_id = sa.session_id
      WHERE s.session_id = ?
      GROUP BY s.session_id`,
      [id]
    );

    if (sessions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: sessions[0]
    });

  } catch (error) {
    console.error('Error fetching session:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch session'
    });
  }
};

/**
 * Delete a session (only by the tutor who created it)
 * - Denies all pending join requests and notifies students
 * - Removes all enrolled students and notifies them of cancellation
 * - Deletes all related records and the session itself
 */
const deleteSession = async (req, res) => {
  const userId = req.session?.userId;
  const { id } = req.params;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    // Verify the session exists and belongs to this tutor, get session details
    const [sessions] = await pool.query(
      `SELECT s.session_id, s.tutor_id, s.title, s.start_time, s.location_details, s.status
       FROM sessions s WHERE s.session_id = ?`,
      [id]
    );

    if (sessions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    const session = sessions[0];

    if (session.tutor_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own sessions'
      });
    }

    // Get tutor's name for notification messages
    const [tutors] = await pool.query(
      'SELECT first_name, last_name FROM users WHERE user_id = ?',
      [userId]
    );
    const tutorName = tutors.length > 0 ? `${tutors[0].first_name} ${tutors[0].last_name}` : 'The tutor';

    // Format the session date/time for notification messages
    const sessionDate = new Date(session.start_time);
    const formattedDate = sessionDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    const formattedTime = sessionDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    // 1. Handle pending join requests - deny them and notify students
    const [pendingRequests] = await pool.query(
      `SELECT sjr.request_id, sjr.requester_user_id, u.first_name, u.last_name
       FROM session_join_requests sjr
       JOIN users u ON sjr.requester_user_id = u.user_id
       WHERE sjr.session_id = ? AND sjr.status = 'pending'`,
      [id]
    );

    for (const request of pendingRequests) {
      // Update request status to denied
      await pool.query(
        `UPDATE session_join_requests SET status = 'denied', responded_at = CURRENT_TIMESTAMP
         WHERE request_id = ?`,
        [request.request_id]
      );

      // Send notification message to student about denied request
      const messageSubject = `Session Cancelled: ${session.title}`;
      let messageContent = `Your request to join the session "${session.title}" has been automatically denied because the session has been cancelled.\n\n`;
      messageContent += `📅 Date: ${formattedDate}\n`;
      messageContent += `🕐 Time: ${formattedTime}\n`;
      messageContent += `📍 Location: ${session.location_details || 'TBD'}\n\n`;
      messageContent += `We apologize for any inconvenience. Feel free to browse other available sessions on the platform.`;

      const [msgResult] = await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, subject, message_type, message_content)
         VALUES (?, ?, ?, 'normal', ?)`,
        [userId, request.requester_user_id, messageSubject, messageContent]
      );

      const messageId = msgResult.insertId;

      // Insert into user_messages for sender (sent folder)
      await pool.query(
        `INSERT INTO user_messages (user_id, message_id, folder, is_read) VALUES (?, ?, 'sent', 1)`,
        [userId, messageId]
      );

      // Insert into user_messages for receiver (inbox folder)
      await pool.query(
        `INSERT INTO user_messages (user_id, message_id, folder, is_read) VALUES (?, ?, 'inbox', 0)`,
        [request.requester_user_id, messageId]
      );
    }

    // 2. Handle enrolled students - remove them and notify about cancellation
    const [enrolledStudents] = await pool.query(
      `SELECT sa.user_id, u.first_name, u.last_name
       FROM session_attendees sa
       JOIN users u ON sa.user_id = u.user_id
       WHERE sa.session_id = ?`,
      [id]
    );

    for (const student of enrolledStudents) {
      // Send cancellation notification message to enrolled student
      const messageSubject = `Session Cancelled: ${session.title}`;
      let messageContent = `We regret to inform you that the session "${session.title}" has been cancelled by ${tutorName}.\n\n`;
      messageContent += `📅 Date: ${formattedDate}\n`;
      messageContent += `🕐 Time: ${formattedTime}\n`;
      messageContent += `📍 Location: ${session.location_details || 'TBD'}\n\n`;
      messageContent += `We apologize for any inconvenience this may cause. Please feel free to browse other available sessions on the platform.`;

      const [msgResult] = await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, subject, message_type, message_content)
         VALUES (?, ?, ?, 'normal', ?)`,
        [userId, student.user_id, messageSubject, messageContent]
      );

      const messageId = msgResult.insertId;

      // Insert into user_messages for sender (sent folder)
      await pool.query(
        `INSERT INTO user_messages (user_id, message_id, folder, is_read) VALUES (?, ?, 'sent', 1)`,
        [userId, messageId]
      );

      // Insert into user_messages for receiver (inbox folder)
      await pool.query(
        `INSERT INTO user_messages (user_id, message_id, folder, is_read) VALUES (?, ?, 'inbox', 0)`,
        [student.user_id, messageId]
      );
    }

    // 3. Delete related records
    await pool.query('DELETE FROM session_courses WHERE session_id = ?', [id]);
    await pool.query('DELETE FROM session_attendees WHERE session_id = ?', [id]);
    await pool.query('DELETE FROM session_join_requests WHERE session_id = ?', [id]);

    // 4. Delete the session
    await pool.query('DELETE FROM sessions WHERE session_id = ?', [id]);

    const notifiedCount = pendingRequests.length + enrolledStudents.length;
    let successMessage = 'Session deleted successfully';
    if (notifiedCount > 0) {
      successMessage += `. ${notifiedCount} student${notifiedCount !== 1 ? 's have' : ' has'} been notified.`;
    }

    return res.status(200).json({
      success: true,
      message: successMessage
    });

  } catch (error) {
    console.error('Error deleting session:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete session'
    });
  }
};

/**
 * Get enrollments for a session (only accessible by the tutor who owns it)
 */
const getSessionEnrollments = async (req, res) => {
  const userId = req.session?.userId;
  const { id } = req.params;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    // Verify the session exists and belongs to this tutor
    const [sessions] = await pool.query(
      'SELECT session_id, tutor_id, title, capacity FROM sessions WHERE session_id = ?',
      [id]
    );

    if (sessions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    if (sessions[0].tutor_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to view this session\'s enrollments'
      });
    }

    // Get enrolled students
    const [enrollments] = await pool.query(
      `SELECT
        u.user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS student_name,
        u.email,
        sa.enrolled_at
      FROM session_attendees sa
      INNER JOIN users u ON sa.user_id = u.user_id
      WHERE sa.session_id = ?
      ORDER BY sa.enrolled_at ASC`,
      [id]
    );

    // Get pending requests
    const [pendingRequests] = await pool.query(
      `SELECT
        sjr.request_id,
        u.user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS student_name,
        u.email,
        sjr.created_at,
        sjr.status
      FROM session_join_requests sjr
      INNER JOIN users u ON sjr.requester_user_id = u.user_id
      WHERE sjr.session_id = ? AND sjr.status = 'pending'
      ORDER BY sjr.created_at ASC`,
      [id]
    );

    return res.status(200).json({
      success: true,
      data: {
        sessionId: sessions[0].session_id,
        sessionTitle: sessions[0].title,
        capacity: sessions[0].capacity,
        enrolledCount: enrollments.length,
        enrollments: enrollments,
        pendingRequests: pendingRequests
      }
    });

  } catch (error) {
    console.error('Error fetching session enrollments:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch session enrollments'
    });
  }
};

/**
 * Remove a student from a session
 * - Removes student from session_attendees
 * - Updates session_join_requests status
 * - Sends automated message to student notifying them of the removal
 */
const removeStudentFromSession = async (req, res) => {
  const userId = req.session?.userId;
  const { id, studentId } = req.params;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    // Verify the session exists and belongs to this tutor, get session details
    const [sessions] = await pool.query(
      `SELECT s.session_id, s.tutor_id, s.title, s.start_time, s.location_details
       FROM sessions s WHERE s.session_id = ?`,
      [id]
    );

    if (sessions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    const session = sessions[0];

    if (session.tutor_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to modify this session'
      });
    }

    // Verify the student exists and get their info
    const [students] = await pool.query(
      'SELECT user_id, first_name, last_name FROM users WHERE user_id = ?',
      [studentId]
    );

    if (students.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    const student = students[0];

    // Remove the student from session_attendees
    const [result] = await pool.query(
      'DELETE FROM session_attendees WHERE session_id = ? AND user_id = ?',
      [id, studentId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student not found in this session'
      });
    }

    // Also update the session_join_requests status if exists
    await pool.query(
      `UPDATE session_join_requests
       SET status = 'denied', responded_at = CURRENT_TIMESTAMP
       WHERE session_id = ? AND requester_user_id = ? AND status = 'accepted'`,
      [id, studentId]
    );

    // Get tutor's name for the notification message
    const [tutors] = await pool.query(
      'SELECT first_name, last_name FROM users WHERE user_id = ?',
      [userId]
    );
    const tutorName = tutors.length > 0 ? `${tutors[0].first_name} ${tutors[0].last_name}` : 'The tutor';

    // Format the session date/time for the message
    const sessionDate = new Date(session.start_time);
    const formattedDate = sessionDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    const formattedTime = sessionDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    // Create notification message to student
    const messageSubject = `Session Update: ${session.title}`;
    let messageContent = `You have been removed from the session "${session.title}".\n\n`;
    messageContent += `📅 Date: ${formattedDate}\n`;
    messageContent += `🕐 Time: ${formattedTime}\n`;
    messageContent += `📍 Location: ${session.location_details || 'TBD'}\n\n`;
    messageContent += `If you have any questions about this change, please contact ${tutorName}.\n\n`;
    messageContent += `Feel free to browse other available sessions on the platform.`;

    // Insert the notification message
    const [msgResult] = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, subject, message_type, message_content)
       VALUES (?, ?, ?, 'normal', ?)`,
      [userId, studentId, messageSubject, messageContent]
    );

    const messageId = msgResult.insertId;

    // Insert into user_messages for sender (sent folder)
    await pool.query(
      `INSERT INTO user_messages (user_id, message_id, folder, is_read) VALUES (?, ?, 'sent', 1)`,
      [userId, messageId]
    );

    // Insert into user_messages for receiver (inbox folder)
    await pool.query(
      `INSERT INTO user_messages (user_id, message_id, folder, is_read) VALUES (?, ?, 'inbox', 0)`,
      [studentId, messageId]
    );

    return res.status(200).json({
      success: true,
      message: `${student.first_name} ${student.last_name} has been removed from the session and notified`
    });

  } catch (error) {
    console.error('Error removing student from session:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove student from session'
    });
  }
};

/**
 * Get all sessions that the current student is enrolled in
 */
const getStudentEnrolledSessions = async (req, res) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
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
        sa.enrolled_at,
        CONCAT(u.first_name, ' ', u.last_name) AS tutor_name,
        u.user_id AS tutor_id,
        GROUP_CONCAT(DISTINCT CONCAT(d.code, ' ', c.course_number) SEPARATOR ', ') AS course_names,
        (SELECT COUNT(*) FROM session_attendees sa2 WHERE sa2.session_id = s.session_id) AS enrolled_count
      FROM session_attendees sa
      INNER JOIN sessions s ON sa.session_id = s.session_id
      INNER JOIN users u ON s.tutor_id = u.user_id
      LEFT JOIN session_courses sc ON s.session_id = sc.session_id
      LEFT JOIN courses c ON sc.course_id = c.course_id
      LEFT JOIN departments d ON c.department_id = d.department_id
      WHERE sa.user_id = ?
        AND s.end_time >= NOW()
      GROUP BY s.session_id, s.title, s.start_time, s.end_time, s.session_type,
               s.capacity, s.location_details, s.status, sa.enrolled_at,
               u.first_name, u.last_name, u.user_id
      ORDER BY s.start_time ASC`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      data: sessions
    });

  } catch (error) {
    console.error('Error fetching enrolled sessions:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch enrolled sessions'
    });
  }
};

/**
 * Unenroll the current student from a session
 */
const unenrollFromSession = async (req, res) => {
  const userId = req.session?.userId;
  const { id } = req.params;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  try {
    // Get session details for the notification message
    const [sessions] = await pool.query(
      `SELECT s.session_id, s.title, s.start_time, s.location_details, s.tutor_id,
              CONCAT(u.first_name, ' ', u.last_name) AS tutor_name
       FROM sessions s
       INNER JOIN users u ON s.tutor_id = u.user_id
       WHERE s.session_id = ?`,
      [id]
    );

    if (sessions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    const session = sessions[0];

    // Check if the student is enrolled in this session
    const [enrollment] = await pool.query(
      'SELECT * FROM session_attendees WHERE session_id = ? AND user_id = ?',
      [id, userId]
    );

    if (enrollment.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'You are not enrolled in this session'
      });
    }

    // Remove the student from session_attendees
    await pool.query(
      'DELETE FROM session_attendees WHERE session_id = ? AND user_id = ?',
      [id, userId]
    );

    // Update any session_join_requests status
    await pool.query(
      `UPDATE session_join_requests
       SET status = 'denied', responded_at = CURRENT_TIMESTAMP
       WHERE session_id = ? AND requester_user_id = ? AND status = 'accepted'`,
      [id, userId]
    );

    // Get student's name for the notification message
    const [students] = await pool.query(
      'SELECT first_name, last_name FROM users WHERE user_id = ?',
      [userId]
    );
    const studentName = students.length > 0 ? `${students[0].first_name} ${students[0].last_name}` : 'A student';

    // Format the session date/time for the message
    const sessionDate = new Date(session.start_time);
    const formattedDate = sessionDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    const formattedTime = sessionDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    // Send notification message to the tutor
    const messageSubject = `Student Unenrolled: ${session.title}`;
    let messageContent = `${studentName} has unenrolled from your session "${session.title}".\n\n`;
    messageContent += `📅 Date: ${formattedDate}\n`;
    messageContent += `🕐 Time: ${formattedTime}\n`;
    messageContent += `📍 Location: ${session.location_details || 'TBD'}\n\n`;
    messageContent += `A spot is now available in this session.`;

    const [msgResult] = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, subject, message_type, message_content)
       VALUES (?, ?, ?, 'normal', ?)`,
      [userId, session.tutor_id, messageSubject, messageContent]
    );

    const messageId = msgResult.insertId;

    // Insert into user_messages for sender (sent folder)
    await pool.query(
      `INSERT INTO user_messages (user_id, message_id, folder, is_read) VALUES (?, ?, 'sent', 1)`,
      [userId, messageId]
    );

    // Insert into user_messages for receiver (inbox folder)
    await pool.query(
      `INSERT INTO user_messages (user_id, message_id, folder, is_read) VALUES (?, ?, 'inbox', 0)`,
      [session.tutor_id, messageId]
    );

    return res.status(200).json({
      success: true,
      message: 'Successfully unenrolled from the session'
    });

  } catch (error) {
    console.error('Error unenrolling from session:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to unenroll from session'
    });
  }
};

module.exports = {
  createSession,
  getSessionById,
  deleteSession,
  getSessionEnrollments,
  removeStudentFromSession,
  getStudentEnrolledSessions,
  unenrollFromSession
};
