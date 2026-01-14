const { pool } = require('../config/db');

/**
 * Send a session join request to a tutor
 * Creates a message with message_type='session_join_request' and a session_join_requests record
 */
const sendSessionRequest = async (req, res) => {
  // Check if user is logged in
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in to send a request'
    });
  }

  const studentId = req.session.userId;
  const { sessionId, tutorId, message } = req.body;

  // Validate required fields
  if (!sessionId || !tutorId) {
    return res.status(400).json({
      success: false,
      message: 'Session ID and Tutor ID are required'
    });
  }

  try {
    // Verify the session exists and get its details
    const [sessions] = await pool.query(
      `SELECT s.session_id, s.tutor_id, s.title, s.start_time, s.end_time,
              s.session_type, s.capacity, s.location_details,
              (SELECT COUNT(*) FROM session_attendees WHERE session_id = s.session_id) as enrolled_count
       FROM sessions s
       WHERE s.session_id = ?`,
      [sessionId]
    );

    if (sessions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    const session = sessions[0];

    // Verify the tutor ID matches the session's tutor
    if (session.tutor_id !== parseInt(tutorId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tutor for this session'
      });
    }

    // Prevent students from requesting their own sessions (if they're also a tutor)
    if (studentId === session.tutor_id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot request to join your own session'
      });
    }

    // Check if session is full
    if (session.enrolled_count >= session.capacity) {
      return res.status(400).json({
        success: false,
        message: 'This session is already full'
      });
    }

    // Check if student already has a pending or accepted request for this session
    const [existingRequests] = await pool.query(
      `SELECT status FROM session_join_requests
       WHERE session_id = ? AND requester_user_id = ?`,
      [sessionId, studentId]
    );

    if (existingRequests.length > 0) {
      const existingStatus = existingRequests[0].status;
      if (existingStatus === 'pending') {
        return res.status(400).json({
          success: false,
          message: 'You already have a pending request for this session'
        });
      } else if (existingStatus === 'accepted') {
        return res.status(400).json({
          success: false,
          message: 'You are already enrolled in this session'
        });
      }
      // If denied, allow them to request again - delete old request
      await pool.query(
        `DELETE FROM session_join_requests WHERE session_id = ? AND requester_user_id = ?`,
        [sessionId, studentId]
      );
    }

    // Check if student is already enrolled
    const [existingEnrollment] = await pool.query(
      `SELECT 1 FROM session_attendees WHERE session_id = ? AND user_id = ?`,
      [sessionId, studentId]
    );

    if (existingEnrollment.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You are already enrolled in this session'
      });
    }

    // Get the student's name for the message
    const [students] = await pool.query(
      'SELECT first_name, last_name FROM users WHERE user_id = ?',
      [studentId]
    );

    if (students.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    const studentName = `${students[0].first_name} ${students[0].last_name}`;

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

    // Build the message content with structured format
    const sessionType = session.session_type === 'one_on_one' ? 'One-on-One' : 'Group';
    const sessionTitle = session.title || 'Tutoring Session';

    // Create subject line for session request
    const messageSubject = `Session Request: ${sessionTitle}`;

    let messageContent = `📚 Session Request: ${sessionTitle}\n`;
    messageContent += `📅 ${formattedDate} at ${formattedTime}\n`;
    messageContent += `📍 ${session.location_details || 'Location TBD'}\n`;
    messageContent += `👥 Type: ${sessionType}\n\n`;
    messageContent += `${studentName} would like to join this session.`;

    if (message && message.trim()) {
      messageContent += `\n\n💬 Message from student:\n"${message.trim()}"`;
    }

    // Insert the message into the messages table with message_type = 'session_join_request'
    const [result] = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, subject, message_type, message_content)
       VALUES (?, ?, ?, 'session_join_request', ?)`,
      [studentId, tutorId, messageSubject, messageContent]
    );

    const messageId = result.insertId;

    // Insert into user_messages for sender (sent folder)
    await pool.query(
      `INSERT INTO user_messages (user_id, message_id, folder, is_read)
       VALUES (?, ?, 'sent', 1)`,
      [studentId, messageId]
    );

    // Insert into user_messages for receiver (inbox folder)
    await pool.query(
      `INSERT INTO user_messages (user_id, message_id, folder, is_read)
       VALUES (?, ?, 'inbox', 0)`,
      [tutorId, messageId]
    );

    // Insert into session_join_requests table
    await pool.query(
      `INSERT INTO session_join_requests (session_id, requester_user_id, tutor_user_id, message_id, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [sessionId, studentId, tutorId, messageId]
    );

    return res.status(201).json({
      success: true,
      message: 'Your request has been sent to the tutor',
      messageId: messageId
    });

  } catch (error) {
    console.error('Error sending session request:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send request. Please try again.'
    });
  }
};

/**
 * Get inbox messages (messages received by the current user)
 * Includes message_type and session_join_request details for session requests
 */
const getInboxMessages = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in to view messages'
    });
  }

  const userId = req.session.userId;

  try {
    const [messages] = await pool.query(
      `SELECT
        m.message_id,
        m.sender_id,
        CONCAT(u.first_name, ' ', u.last_name) AS sender_name,
        u.email AS sender_email,
        m.subject,
        m.message_type,
        m.message_content,
        m.time_sent,
        um.is_read,
        sjr.request_id,
        sjr.session_id,
        sjr.status AS request_status,
        s.title AS session_title,
        s.start_time AS session_start_time,
        s.capacity AS session_capacity,
        (SELECT COUNT(*) FROM session_attendees WHERE session_id = sjr.session_id) AS session_enrolled
      FROM user_messages um
      INNER JOIN messages m ON um.message_id = m.message_id
      INNER JOIN users u ON m.sender_id = u.user_id
      LEFT JOIN session_join_requests sjr ON m.message_id = sjr.message_id
      LEFT JOIN sessions s ON sjr.session_id = s.session_id
      WHERE um.user_id = ? AND um.folder = 'inbox'
      ORDER BY m.time_sent DESC`,
      [userId]
    );

    return res.json({
      success: true,
      messages: messages.map(msg => ({
        id: msg.message_id,
        from: msg.sender_name,
        fromId: msg.sender_id,
        fromEmail: msg.sender_email,
        subject: msg.subject || 'No Subject',
        body: msg.message_content,
        date: msg.time_sent,
        unread: !msg.is_read,
        messageType: msg.message_type,
        // Session request specific fields
        requestId: msg.request_id || null,
        sessionId: msg.session_id || null,
        requestStatus: msg.request_status || null,
        sessionTitle: msg.session_title || null,
        sessionStartTime: msg.session_start_time || null,
        sessionCapacity: msg.session_capacity || null,
        sessionEnrolled: msg.session_enrolled || 0
      }))
    });
  } catch (error) {
    console.error('Error fetching inbox messages:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch messages'
    });
  }
};

/**
 * Get sent messages (messages sent by the current user)
 */
const getSentMessages = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in to view messages'
    });
  }

  const userId = req.session.userId;

  try {
    const [messages] = await pool.query(
      `SELECT
        m.message_id,
        m.receiver_id,
        CONCAT(u.first_name, ' ', u.last_name) AS receiver_name,
        u.email AS receiver_email,
        m.subject,
        m.message_content,
        m.time_sent
      FROM user_messages um
      INNER JOIN messages m ON um.message_id = m.message_id
      INNER JOIN users u ON m.receiver_id = u.user_id
      WHERE um.user_id = ? AND um.folder = 'sent'
      ORDER BY m.time_sent DESC`,
      [userId]
    );

    return res.json({
      success: true,
      messages: messages.map(msg => ({
        id: msg.message_id,
        to: msg.receiver_name,
        toId: msg.receiver_id,
        toEmail: msg.receiver_email,
        subject: msg.subject || 'No Subject',
        body: msg.message_content,
        date: msg.time_sent,
        read: true // Sent messages are always "read" by sender
      }))
    });
  } catch (error) {
    console.error('Error fetching sent messages:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch messages'
    });
  }
};

/**
 * Get draft messages
 */
const getDraftMessages = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in to view drafts'
    });
  }

  const userId = req.session.userId;

  try {
    const [messages] = await pool.query(
      `SELECT
        m.message_id,
        m.receiver_id,
        CONCAT(u.first_name, ' ', u.last_name) AS receiver_name,
        u.email AS receiver_email,
        m.subject,
        m.message_content,
        m.time_sent
      FROM user_messages um
      INNER JOIN messages m ON um.message_id = m.message_id
      LEFT JOIN users u ON m.receiver_id = u.user_id
      WHERE um.user_id = ? AND um.folder = 'drafts'
      ORDER BY m.time_sent DESC`,
      [userId]
    );

    return res.json({
      success: true,
      messages: messages.map(msg => ({
        id: msg.message_id,
        to: msg.receiver_name || '',
        toId: msg.receiver_id,
        toEmail: msg.receiver_email || '',
        subject: msg.subject || '',
        body: msg.message_content || '',
        date: msg.time_sent
      }))
    });
  } catch (error) {
    console.error('Error fetching draft messages:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch drafts'
    });
  }
};

/**
 * Get trash messages
 */
const getTrashMessages = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in to view trash'
    });
  }

  const userId = req.session.userId;

  try {
    const [messages] = await pool.query(
      `SELECT
        m.message_id,
        m.sender_id,
        m.receiver_id,
        CONCAT(sender.first_name, ' ', sender.last_name) AS sender_name,
        sender.email AS sender_email,
        CONCAT(receiver.first_name, ' ', receiver.last_name) AS receiver_name,
        receiver.email AS receiver_email,
        m.subject,
        m.message_content,
        m.time_sent,
        um.is_read
      FROM user_messages um
      INNER JOIN messages m ON um.message_id = m.message_id
      LEFT JOIN users sender ON m.sender_id = sender.user_id
      LEFT JOIN users receiver ON m.receiver_id = receiver.user_id
      WHERE um.user_id = ? AND um.folder = 'trash'
      ORDER BY um.added_at DESC`,
      [userId]
    );

    return res.json({
      success: true,
      messages: messages.map(msg => {
        // Determine if this was an inbox or sent message based on sender/receiver
        const isFromMe = msg.sender_id === userId;
        return {
          id: msg.message_id,
          from: isFromMe ? 'You' : msg.sender_name,
          fromId: msg.sender_id,
          fromEmail: msg.sender_email,
          to: msg.receiver_name,
          toId: msg.receiver_id,
          toEmail: msg.receiver_email,
          subject: msg.subject || 'No Subject',
          body: msg.message_content,
          date: msg.time_sent,
          unread: !msg.is_read,
          wasFromMe: isFromMe
        };
      })
    });
  } catch (error) {
    console.error('Error fetching trash messages:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch trash'
    });
  }
};

/**
 * Send a new message to another user
 */
const sendMessage = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in to send messages'
    });
  }

  const senderId = req.session.userId;
  const { receiverId, receiverEmail, subject, message } = req.body;

  // Need either receiverId or receiverEmail
  if (!receiverId && !receiverEmail) {
    return res.status(400).json({
      success: false,
      message: 'Recipient is required'
    });
  }

  if (!subject || !subject.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Subject is required'
    });
  }

  if (!message || !message.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Message content is required'
    });
  }

  try {
    let targetUserId = receiverId;

    // If email provided instead of ID, look up the user (case-insensitive)
    if (!targetUserId && receiverEmail) {
      const [users] = await pool.query(
        'SELECT user_id FROM users WHERE LOWER(email) = LOWER(?)',
        [receiverEmail.trim()]
      );

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Recipient not found. Please check the email address.'
        });
      }

      targetUserId = users[0].user_id;
    }

    // Prevent sending to self
    if (parseInt(targetUserId) === senderId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot send a message to yourself'
      });
    }

    // Verify recipient exists
    const [recipient] = await pool.query(
      'SELECT user_id, first_name, last_name FROM users WHERE user_id = ?',
      [targetUserId]
    );

    if (recipient.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Recipient not found'
      });
    }

    // Insert the message
    const [result] = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, subject, message_content)
       VALUES (?, ?, ?, ?)`,
      [senderId, targetUserId, subject.trim(), message.trim()]
    );

    const messageId = result.insertId;

    // Insert into user_messages for sender (sent folder)
    await pool.query(
      `INSERT INTO user_messages (user_id, message_id, folder, is_read)
       VALUES (?, ?, 'sent', 1)`,
      [senderId, messageId]
    );

    // Insert into user_messages for receiver (inbox folder)
    await pool.query(
      `INSERT INTO user_messages (user_id, message_id, folder, is_read)
       VALUES (?, ?, 'inbox', 0)`,
      [targetUserId, messageId]
    );

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      messageId: messageId,
      recipient: `${recipient[0].first_name} ${recipient[0].last_name}`
    });

  } catch (error) {
    console.error('Error sending message:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send message. Please try again.'
    });
  }
};

/**
 * Save a draft message
 */
const saveDraft = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in to save drafts'
    });
  }

  const senderId = req.session.userId;
  const { receiverId, receiverEmail, subject, message } = req.body;

  try {
    let targetUserId = null;

    // If email provided, try to look up the user (optional for drafts, case-insensitive)
    if (receiverEmail && receiverEmail.trim()) {
      const [users] = await pool.query(
        'SELECT user_id FROM users WHERE LOWER(email) = LOWER(?)',
        [receiverEmail.trim()]
      );
      if (users.length > 0) {
        targetUserId = users[0].user_id;
      }
    } else if (receiverId) {
      targetUserId = receiverId;
    }

    // For drafts, we need a receiver_id but it can be the sender temporarily
    // We'll use the sender as a placeholder if no receiver specified
    const actualReceiverId = targetUserId || senderId;

    // Insert the draft message
    const [result] = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, subject, message_content)
       VALUES (?, ?, ?, ?)`,
      [senderId, actualReceiverId, subject || '', message || '']
    );

    const messageId = result.insertId;

    // Insert into user_messages for sender (drafts folder)
    await pool.query(
      `INSERT INTO user_messages (user_id, message_id, folder, is_read)
       VALUES (?, ?, 'drafts', 1)`,
      [senderId, messageId]
    );

    return res.status(201).json({
      success: true,
      message: 'Draft saved',
      messageId: messageId
    });

  } catch (error) {
    console.error('Error saving draft:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save draft'
    });
  }
};

/**
 * Update an existing draft
 */
const updateDraft = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in'
    });
  }

  const userId = req.session.userId;
  const messageId = req.params.id;
  const { receiverId, receiverEmail, subject, message } = req.body;

  try {
    // Verify the user owns this draft
    const [drafts] = await pool.query(
      `SELECT um.message_id FROM user_messages um
       WHERE um.user_id = ? AND um.message_id = ? AND um.folder = 'drafts'`,
      [userId, messageId]
    );

    if (drafts.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Draft not found'
      });
    }

    let targetUserId = null;

    // If email provided, try to look up the user (case-insensitive)
    if (receiverEmail && receiverEmail.trim()) {
      const [users] = await pool.query(
        'SELECT user_id FROM users WHERE LOWER(email) = LOWER(?)',
        [receiverEmail.trim()]
      );
      if (users.length > 0) {
        targetUserId = users[0].user_id;
      }
    } else if (receiverId) {
      targetUserId = receiverId;
    }

    // Update the message (also update time_sent to track last modification)
    if (targetUserId) {
      await pool.query(
        `UPDATE messages SET receiver_id = ?, subject = ?, message_content = ?, time_sent = CURRENT_TIMESTAMP
         WHERE message_id = ?`,
        [targetUserId, subject || '', message || '', messageId]
      );
    } else {
      await pool.query(
        `UPDATE messages SET subject = ?, message_content = ?, time_sent = CURRENT_TIMESTAMP
         WHERE message_id = ?`,
        [subject || '', message || '', messageId]
      );
    }

    return res.json({
      success: true,
      message: 'Draft updated'
    });

  } catch (error) {
    console.error('Error updating draft:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update draft'
    });
  }
};

/**
 * Send a draft (convert to sent message)
 */
const sendDraft = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in'
    });
  }

  const userId = req.session.userId;
  const messageId = req.params.id;

  try {
    // Get the draft
    const [drafts] = await pool.query(
      `SELECT m.message_id, m.sender_id, m.receiver_id, m.subject, m.message_content
       FROM user_messages um
       INNER JOIN messages m ON um.message_id = m.message_id
       WHERE um.user_id = ? AND um.message_id = ? AND um.folder = 'drafts'`,
      [userId, messageId]
    );

    if (drafts.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Draft not found'
      });
    }

    const draft = drafts[0];

    // Validate the draft has required fields
    if (!draft.receiver_id || draft.receiver_id === userId) {
      return res.status(400).json({
        success: false,
        message: 'Please specify a valid recipient before sending'
      });
    }

    if (!draft.subject || !draft.subject.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Subject is required'
      });
    }

    if (!draft.message_content || !draft.message_content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    // Get recipient name
    const [recipient] = await pool.query(
      'SELECT first_name, last_name FROM users WHERE user_id = ?',
      [draft.receiver_id]
    );

    if (recipient.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Recipient not found'
      });
    }

    // Update time_sent to now
    await pool.query(
      `UPDATE messages SET time_sent = CURRENT_TIMESTAMP WHERE message_id = ?`,
      [messageId]
    );

    // Change folder from drafts to sent for sender
    await pool.query(
      `UPDATE user_messages SET folder = 'sent' WHERE user_id = ? AND message_id = ?`,
      [userId, messageId]
    );

    // Add to receiver's inbox
    await pool.query(
      `INSERT INTO user_messages (user_id, message_id, folder, is_read)
       VALUES (?, ?, 'inbox', 0)`,
      [draft.receiver_id, messageId]
    );

    return res.json({
      success: true,
      message: 'Message sent successfully',
      recipient: `${recipient[0].first_name} ${recipient[0].last_name}`
    });

  } catch (error) {
    console.error('Error sending draft:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send draft'
    });
  }
};

/**
 * Mark a message as read
 */
const markMessageAsRead = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in'
    });
  }

  const userId = req.session.userId;
  const messageId = req.params.id;

  try {
    // Update is_read in user_messages for this user
    const [result] = await pool.query(
      `UPDATE user_messages SET is_read = 1
       WHERE user_id = ? AND message_id = ?`,
      [userId, messageId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found or you do not have permission'
      });
    }

    return res.json({
      success: true,
      message: 'Message marked as read'
    });
  } catch (error) {
    console.error('Error marking message as read:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update message'
    });
  }
};

/**
 * Get unread message count for the current user
 */
const getUnreadCount = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in'
    });
  }

  const userId = req.session.userId;

  try {
    const [result] = await pool.query(
      `SELECT COUNT(*) AS unread_count
       FROM user_messages
       WHERE user_id = ? AND folder = 'inbox' AND is_read = 0`,
      [userId]
    );

    return res.json({
      success: true,
      unreadCount: result[0].unread_count
    });
  } catch (error) {
    console.error('Error getting unread count:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get unread count'
    });
  }
};

/**
 * Search users by email or name (for compose autocomplete)
 */
const searchUsers = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in'
    });
  }

  const query = (req.query.q || '').trim();
  const userId = req.session.userId;

  if (query.length < 2) {
    return res.json({
      success: true,
      users: []
    });
  }

  try {
    const [users] = await pool.query(
      `SELECT user_id, email, first_name, last_name, role
       FROM users
       WHERE user_id != ?
         AND (
           email LIKE ? OR
           CONCAT(first_name, ' ', last_name) LIKE ?
         )
       LIMIT 10`,
      [userId, `%${query}%`, `%${query}%`]
    );

    return res.json({
      success: true,
      users: users.map(u => ({
        id: u.user_id,
        email: u.email,
        name: `${u.first_name} ${u.last_name}`,
        role: u.role
      }))
    });
  } catch (error) {
    console.error('Error searching users:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to search users'
    });
  }
};

/**
 * Move a message to trash (or permanently delete if already in trash)
 */
const deleteMessage = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in'
    });
  }

  const userId = req.session.userId;
  const messageId = req.params.id;

  try {
    // Check if user has this message and what folder it's in
    const [userMessages] = await pool.query(
      `SELECT folder FROM user_messages WHERE user_id = ? AND message_id = ?`,
      [userId, messageId]
    );

    if (userMessages.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    const currentFolder = userMessages[0].folder;

    if (currentFolder === 'trash') {
      // Permanently delete from user_messages
      await pool.query(
        `DELETE FROM user_messages WHERE user_id = ? AND message_id = ?`,
        [userId, messageId]
      );

      return res.json({
        success: true,
        message: 'Message permanently deleted'
      });
    } else {
      // Move to trash
      await pool.query(
        `UPDATE user_messages SET folder = 'trash' WHERE user_id = ? AND message_id = ?`,
        [userId, messageId]
      );

      return res.json({
        success: true,
        message: 'Message moved to trash'
      });
    }
  } catch (error) {
    console.error('Error deleting message:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete message'
    });
  }
};

/**
 * Restore a message from trash
 */
const restoreFromTrash = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in'
    });
  }

  const userId = req.session.userId;
  const messageId = req.params.id;

  try {
    // Verify the message is in trash
    const [userMessages] = await pool.query(
      `SELECT um.folder, m.sender_id, m.receiver_id
       FROM user_messages um
       INNER JOIN messages m ON um.message_id = m.message_id
       WHERE um.user_id = ? AND um.message_id = ? AND um.folder = 'trash'`,
      [userId, messageId]
    );

    if (userMessages.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found in trash'
      });
    }

    const msg = userMessages[0];

    // Check if this was a draft by seeing if any other user has this message
    // Drafts only have one user_messages entry (the sender/owner)
    const [otherEntries] = await pool.query(
      `SELECT COUNT(*) as count FROM user_messages WHERE message_id = ? AND user_id != ?`,
      [messageId, userId]
    );

    let originalFolder;
    if (otherEntries[0].count === 0 && msg.sender_id === userId) {
      // No other user has this message and current user is sender = it was a draft
      originalFolder = 'drafts';
    } else if (msg.sender_id === userId) {
      // Current user sent it and receiver has it = restore to sent
      originalFolder = 'sent';
    } else {
      // Current user received it = restore to inbox
      originalFolder = 'inbox';
    }

    // Restore to original folder
    await pool.query(
      `UPDATE user_messages SET folder = ? WHERE user_id = ? AND message_id = ?`,
      [originalFolder, userId, messageId]
    );

    return res.json({
      success: true,
      message: `Message restored to ${originalFolder}`
    });
  } catch (error) {
    console.error('Error restoring message:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to restore message'
    });
  }
};

/**
 * Permanently delete a draft
 */
const deleteDraft = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in'
    });
  }

  const userId = req.session.userId;
  const messageId = req.params.id;

  try {
    // Verify the user owns this draft
    const [drafts] = await pool.query(
      `SELECT um.message_id FROM user_messages um
       WHERE um.user_id = ? AND um.message_id = ? AND um.folder = 'drafts'`,
      [userId, messageId]
    );

    if (drafts.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Draft not found'
      });
    }

    // Permanently delete from user_messages (draft only exists for this user)
    await pool.query(
      `DELETE FROM user_messages WHERE user_id = ? AND message_id = ?`,
      [userId, messageId]
    );

    // Also delete the message itself since drafts aren't shared
    // Check if any other user_messages entries exist for this message
    const [otherEntries] = await pool.query(
      `SELECT COUNT(*) as count FROM user_messages WHERE message_id = ?`,
      [messageId]
    );

    if (otherEntries[0].count === 0) {
      // No other references, safe to delete the message
      await pool.query(
        `DELETE FROM messages WHERE message_id = ?`,
        [messageId]
      );
    }

    return res.json({
      success: true,
      message: 'Draft permanently deleted'
    });
  } catch (error) {
    console.error('Error deleting draft:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete draft'
    });
  }
};

/**
 * Empty trash (permanently delete all messages in trash)
 */
const emptyTrash = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in'
    });
  }

  const userId = req.session.userId;

  try {
    const [result] = await pool.query(
      `DELETE FROM user_messages WHERE user_id = ? AND folder = 'trash'`,
      [userId]
    );

    return res.json({
      success: true,
      message: `Deleted ${result.affectedRows} messages from trash`
    });
  } catch (error) {
    console.error('Error emptying trash:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to empty trash'
    });
  }
};

/**
 * Accept a session join request
 * - Updates session_join_requests status to 'accepted'
 * - Adds student to session_attendees
 * - Sends acceptance message to student
 */
const acceptSessionRequest = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in'
    });
  }

  const tutorId = req.session.userId;
  const requestId = parseInt(req.params.id, 10);

  if (isNaN(requestId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid request ID'
    });
  }

  try {
    // Get the request details
    const [requests] = await pool.query(
      `SELECT sjr.*, s.title, s.capacity, s.start_time, s.location_details,
              CONCAT(u.first_name, ' ', u.last_name) AS student_name,
              u.user_id AS student_id,
              (SELECT COUNT(*) FROM session_attendees WHERE session_id = sjr.session_id) AS enrolled_count
       FROM session_join_requests sjr
       INNER JOIN sessions s ON sjr.session_id = s.session_id
       INNER JOIN users u ON sjr.requester_user_id = u.user_id
       WHERE sjr.request_id = ?`,
      [requestId]
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    const request = requests[0];

    // Verify the current user is the tutor for this request
    if (request.tutor_user_id !== tutorId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to accept this request'
      });
    }

    // Check if request is still pending
    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `This request has already been ${request.status}`
      });
    }

    // Check if session is full
    if (request.enrolled_count >= request.capacity) {
      return res.status(400).json({
        success: false,
        message: 'This session is already full. Cannot accept more students.'
      });
    }

    // Check if student is already enrolled (edge case)
    const [existingEnrollment] = await pool.query(
      `SELECT 1 FROM session_attendees WHERE session_id = ? AND user_id = ?`,
      [request.session_id, request.student_id]
    );

    if (existingEnrollment.length > 0) {
      // Update request status anyway
      await pool.query(
        `UPDATE session_join_requests SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
         WHERE request_id = ?`,
        [requestId]
      );

      return res.status(400).json({
        success: false,
        message: 'Student is already enrolled in this session'
      });
    }

    // Update request status to 'accepted'
    await pool.query(
      `UPDATE session_join_requests SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
       WHERE request_id = ?`,
      [requestId]
    );

    // Add student to session_attendees
    await pool.query(
      `INSERT INTO session_attendees (session_id, user_id) VALUES (?, ?)`,
      [request.session_id, request.student_id]
    );

    // Format the session date/time for the response message
    const sessionDate = new Date(request.start_time);
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

    // Get tutor's name
    const [tutors] = await pool.query(
      'SELECT first_name, last_name FROM users WHERE user_id = ?',
      [tutorId]
    );
    const tutorName = tutors.length > 0 ? `${tutors[0].first_name} ${tutors[0].last_name}` : 'Your tutor';

    // Create acceptance message to student
    const acceptSubject = `Request Accepted: ${request.title}`;
    let acceptContent = `🎉 Great news! Your request to join "${request.title}" has been accepted!\n\n`;
    acceptContent += `📅 Date: ${formattedDate}\n`;
    acceptContent += `🕐 Time: ${formattedTime}\n`;
    acceptContent += `📍 Location: ${request.location_details || 'TBD'}\n\n`;
    acceptContent += `${tutorName} is looking forward to seeing you at the session!`;

    // Insert the acceptance message
    const [msgResult] = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, subject, message_type, message_content)
       VALUES (?, ?, ?, 'normal', ?)`,
      [tutorId, request.student_id, acceptSubject, acceptContent]
    );

    const messageId = msgResult.insertId;

    // Insert into user_messages for sender (sent folder)
    await pool.query(
      `INSERT INTO user_messages (user_id, message_id, folder, is_read) VALUES (?, ?, 'sent', 1)`,
      [tutorId, messageId]
    );

    // Insert into user_messages for receiver (inbox folder)
    await pool.query(
      `INSERT INTO user_messages (user_id, message_id, folder, is_read) VALUES (?, ?, 'inbox', 0)`,
      [request.student_id, messageId]
    );

    return res.json({
      success: true,
      message: `${request.student_name} has been enrolled in the session`
    });

  } catch (error) {
    console.error('Error accepting session request:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to accept request. Please try again.'
    });
  }
};

/**
 * Deny a session join request
 * - Updates session_join_requests status to 'denied'
 * - Sends denial message to student
 */
const denySessionRequest = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in'
    });
  }

  const tutorId = req.session.userId;
  const requestId = parseInt(req.params.id, 10);
  const { reason } = req.body; // Optional reason for denial

  if (isNaN(requestId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid request ID'
    });
  }

  try {
    // Get the request details
    const [requests] = await pool.query(
      `SELECT sjr.*, s.title, s.start_time,
              CONCAT(u.first_name, ' ', u.last_name) AS student_name,
              u.user_id AS student_id
       FROM session_join_requests sjr
       INNER JOIN sessions s ON sjr.session_id = s.session_id
       INNER JOIN users u ON sjr.requester_user_id = u.user_id
       WHERE sjr.request_id = ?`,
      [requestId]
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    const request = requests[0];

    // Verify the current user is the tutor for this request
    if (request.tutor_user_id !== tutorId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to deny this request'
      });
    }

    // Check if request is still pending
    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `This request has already been ${request.status}`
      });
    }

    // Update request status to 'denied'
    await pool.query(
      `UPDATE session_join_requests SET status = 'denied', responded_at = CURRENT_TIMESTAMP
       WHERE request_id = ?`,
      [requestId]
    );

    // Get tutor's name
    const [tutors] = await pool.query(
      'SELECT first_name, last_name FROM users WHERE user_id = ?',
      [tutorId]
    );
    const tutorName = tutors.length > 0 ? `${tutors[0].first_name} ${tutors[0].last_name}` : 'The tutor';

    // Create denial message to student
    const denySubject = `Request Update: ${request.title}`;
    let denyContent = `Unfortunately, your request to join "${request.title}" was not accepted.\n\n`;

    if (reason && reason.trim()) {
      denyContent += `💬 Message from tutor:\n"${reason.trim()}"\n\n`;
    }

    denyContent += `Don't be discouraged! Feel free to browse other available sessions or try again later.`;

    // Insert the denial message
    const [msgResult] = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, subject, message_type, message_content)
       VALUES (?, ?, ?, 'normal', ?)`,
      [tutorId, request.student_id, denySubject, denyContent]
    );

    const messageId = msgResult.insertId;

    // Insert into user_messages for sender (sent folder)
    await pool.query(
      `INSERT INTO user_messages (user_id, message_id, folder, is_read) VALUES (?, ?, 'sent', 1)`,
      [tutorId, messageId]
    );

    // Insert into user_messages for receiver (inbox folder)
    await pool.query(
      `INSERT INTO user_messages (user_id, message_id, folder, is_read) VALUES (?, ?, 'inbox', 0)`,
      [request.student_id, messageId]
    );

    return res.json({
      success: true,
      message: `Request from ${request.student_name} has been denied`
    });

  } catch (error) {
    console.error('Error denying session request:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to deny request. Please try again.'
    });
  }
};

/**
 * Get session request status for a student
 * Used to check if a student already has a pending/accepted request for a session
 */
const getSessionRequestStatus = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'You must be logged in'
    });
  }

  const studentId = req.session.userId;
  const sessionId = parseInt(req.params.sessionId, 10);

  if (isNaN(sessionId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid session ID'
    });
  }

  try {
    // Check for existing request
    const [requests] = await pool.query(
      `SELECT status FROM session_join_requests
       WHERE session_id = ? AND requester_user_id = ?`,
      [sessionId, studentId]
    );

    // Check if already enrolled
    const [enrollment] = await pool.query(
      `SELECT 1 FROM session_attendees WHERE session_id = ? AND user_id = ?`,
      [sessionId, studentId]
    );

    if (enrollment.length > 0) {
      return res.json({
        success: true,
        status: 'enrolled',
        message: 'You are already enrolled in this session'
      });
    }

    if (requests.length > 0) {
      return res.json({
        success: true,
        status: requests[0].status,
        message: requests[0].status === 'pending'
          ? 'Your request is pending approval'
          : requests[0].status === 'accepted'
            ? 'Your request was accepted'
            : 'Your previous request was denied - you can request again'
      });
    }

    return res.json({
      success: true,
      status: null,
      message: 'No existing request for this session'
    });

  } catch (error) {
    console.error('Error checking session request status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check request status'
    });
  }
};

module.exports = {
  sendSessionRequest,
  getInboxMessages,
  getSentMessages,
  getDraftMessages,
  getTrashMessages,
  sendMessage,
  saveDraft,
  updateDraft,
  sendDraft,
  deleteDraft,
  markMessageAsRead,
  getUnreadCount,
  searchUsers,
  deleteMessage,
  restoreFromTrash,
  emptyTrash,
  acceptSessionRequest,
  denySessionRequest,
  getSessionRequestStatus
};
