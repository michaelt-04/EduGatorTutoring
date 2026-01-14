const express = require('express');
const router = express.Router();

const searchController = require('../controllers/searchController');
const authController = require('../controllers/authController');
const dashboardController = require('../controllers/dashboardController');
const tutorController = require('../controllers/tutorController');
const messageController = require('../controllers/messageController');
const tutorProfileController = require('../controllers/tutorProfileController');
const sessionController = require('../controllers/sessionController');

router.get('/health', (req, res) => {
  res.json({ ok: true, message: 'server is running' });
});

// Auth routes
router.post('/api/auth/register', authController.register);
router.post('/api/auth/login', authController.login);
router.post('/api/auth/logout', authController.logout);
router.get('/api/auth/me', authController.getCurrentUser);

// Search routes
router.get('/api/subjects', searchController.getSubjects);
router.get('/api/departments', searchController.getDepartments);
router.get('/api/courses', searchController.getCourses);
router.get('/api/search', searchController.search);

// Session routes
router.post('/api/sessions', sessionController.createSession);
router.get('/api/sessions/:id', searchController.getSessionById);
router.delete('/api/sessions/:id', sessionController.deleteSession);
router.get('/api/sessions/:id/enrollments', sessionController.getSessionEnrollments);
router.delete('/api/sessions/:id/students/:studentId', sessionController.removeStudentFromSession);

// Student enrolled sessions routes
router.get('/api/students/enrolled-sessions', sessionController.getStudentEnrolledSessions);
router.delete('/api/sessions/:id/unenroll', sessionController.unenrollFromSession);

// Dashboard routes
router.get('/api/dashboard/student', dashboardController.getStudentDashboard);
router.get('/api/dashboard/tutor', dashboardController.getTutorDashboard);

// Student course management routes
router.post('/api/students/courses', dashboardController.addStudentCourse);
router.delete('/api/students/courses/:courseId', dashboardController.removeStudentCourse);

// Student calendar route
router.get('/api/students/calendar', dashboardController.getStudentCalendar);

// Tutor calendar route
router.get('/api/tutors/calendar', dashboardController.getTutorCalendar);

// Student profile management
router.put('/api/students/profile', dashboardController.updateStudentProfile);

// Tutor profile management
router.put('/api/tutors/profile', dashboardController.updateTutorProfile);

// Tutor application routes
router.post('/api/tutor/apply', tutorController.applyToBeTutor);
router.get('/api/tutor/application-status', tutorController.getApplicationStatus);

// Tutor course management routes
router.post('/api/tutors/courses', tutorController.addTutorCourse);
router.delete('/api/tutors/courses/:courseId', tutorController.removeTutorCourse);

// Session join request routes
router.post('/api/session-requests', messageController.sendSessionRequest);
router.post('/api/session-requests/:id/accept', messageController.acceptSessionRequest);
router.post('/api/session-requests/:id/deny', messageController.denySessionRequest);
router.get('/api/sessions/:sessionId/request-status', messageController.getSessionRequestStatus);

// Inbox/Message routes
router.get('/api/messages/inbox', messageController.getInboxMessages);
router.get('/api/messages/sent', messageController.getSentMessages);
router.get('/api/messages/drafts', messageController.getDraftMessages);
router.get('/api/messages/trash', messageController.getTrashMessages);
router.post('/api/messages', messageController.sendMessage);
router.post('/api/messages/drafts', messageController.saveDraft);
router.put('/api/messages/drafts/:id', messageController.updateDraft);
router.post('/api/messages/drafts/:id/send', messageController.sendDraft);
router.delete('/api/messages/drafts/:id', messageController.deleteDraft);
router.patch('/api/messages/:id/read', messageController.markMessageAsRead);
router.patch('/api/messages/:id/restore', messageController.restoreFromTrash);
router.delete('/api/messages/trash/empty', messageController.emptyTrash);
router.delete('/api/messages/:id', messageController.deleteMessage);
router.get('/api/messages/unread-count', messageController.getUnreadCount);
router.get('/api/users/search', messageController.searchUsers);

// Tutor profile routes
router.get('/api/tutors/:id', tutorProfileController.getTutorProfile);
router.get('/api/tutors/:id/sessions', tutorProfileController.getTutorSessions);
router.get('/api/tutors/:id/reviews', tutorProfileController.getTutorReviews);

module.exports = router;