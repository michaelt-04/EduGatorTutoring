/**
 * Tutor Dashboard - Loads and displays tutor data from the database
 */

const API_BASE_URL = window.location.origin;

// Store tutor's courses for session creation
let tutorCourses = [];

// Helper function to show messages
function showMessage(message, isError = false) {
  const errorElement = document.getElementById('error-message');
  const successElement = document.getElementById('success-message');

  if (isError) {
      errorElement.textContent = message;
      errorElement.style.display = 'block';
      successElement.style.display = 'none';
  } else {
      successElement.textContent = message;
      successElement.style.display = 'block';
      errorElement.style.display = 'none';
  }

  // Hide after 5 seconds
  setTimeout(() => {
      errorElement.style.display = 'none';
      successElement.style.display = 'none';
  }, 5000);
}

// Helper function to show confirmation dialog
function showConfirm(message, title = 'Confirm Action') {
  return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      const titleElement = document.getElementById('confirmTitle');
      const messageElement = document.getElementById('confirmMessage');
      const okButton = document.getElementById('confirmOk');
      const cancelButton = document.getElementById('confirmCancel');

      titleElement.textContent = title;
      messageElement.textContent = message;
      modal.style.display = 'flex';

      function handleOk() {
          modal.style.display = 'none';
          cleanup();
          resolve(true);
      }

      function handleCancel() {
          modal.style.display = 'none';
          cleanup();
          resolve(false);
      }

      function cleanup() {
          okButton.removeEventListener('click', handleOk);
          cancelButton.removeEventListener('click', handleCancel);
      }

      okButton.addEventListener('click', handleOk);
      cancelButton.addEventListener('click', handleCancel);
  });
}

// Format date for display
function formatDate(dateString) {
  if (!dateString) return 'Not set';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Format datetime for sessions
function formatDateTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// Format time
function formatTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// Load and populate tutor dashboard
async function loadTutorDashboard() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/dashboard/tutor`, {
      credentials: 'include'
    });

    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = 'auth/login.html';
        return;
      }
      throw new Error('Failed to load dashboard data');
    }

    const result = await response.json();
    if (result.success && result.data) {
      populateDashboard(result.data);
      // Hide loading, show content
      document.getElementById('loading').style.display = 'none';
      document.getElementById('dashboardContent').style.display = 'block';
    }
  } catch (error) {
    console.error('Error loading dashboard:', error);
    showError('Failed to load dashboard data. Please refresh the page.');
  }
}

// Populate the dashboard with data
function populateDashboard(data) {
  const { profile, courses, sessions, stats } = data;

  // Store profile data for editing
  currentProfile = profile;
  // Store courses for session creation dropdown
  tutorCourses = courses;

  // Update profile header
  const nameElement = document.querySelector('.profile-info h1');
  if (nameElement) {
    nameElement.textContent = `${profile.firstName} ${profile.lastName}`;
  }

  const subtitleElement = document.querySelector('.profile-subtitle');
  if (subtitleElement) {
    // Get unique subjects/departments from courses
    const subjects = [...new Set(courses.map(c => c.code.split(' ')[0]))].join(', ');
    subtitleElement.textContent = subjects ? `${subjects} Tutor` : 'Tutor';
  }

  // Update profile info grid
  updateInfoItem('Email', profile.email);
  updateInfoItem('Member Since', formatDate(profile.memberSince));
  updateInfoItem('Rating', stats.rating ? `${stats.rating} / 5.0` : 'No ratings yet');

  // Update bio
  const bioElement = document.querySelector('.bio-text');
  if (bioElement) {
    bioElement.textContent = profile.bio || profile.description || 'No bio added yet.';
  }

  // Update stats
  updateStat('Courses Offered', stats.coursesOffered);
  updateStat('Active Sessions', stats.activeSessions);
  updateStat('Students Helped', stats.studentsHelped);

  // Update courses
  populateCourses(courses, sessions);

  // Update sessions
  populateSessions(sessions);
}

// Update info item by label
function updateInfoItem(label, value) {
  const items = document.querySelectorAll('.info-item');
  items.forEach(item => {
    const labelElement = item.querySelector('.info-label');
    if (labelElement && labelElement.textContent === label) {
      const valueElement = item.querySelector('.info-value');
      if (valueElement) {
        valueElement.textContent = value;
      }
    }
  });
}

// Update stat by label
function updateStat(label, value) {
  const statCards = document.querySelectorAll('.stat-card');
  statCards.forEach(card => {
    const labelElement = card.querySelector('.stat-label');
    if (labelElement && labelElement.textContent === label) {
      const numberElement = card.querySelector('.stat-number');
      if (numberElement) {
        numberElement.textContent = value;
      }
    }
  });
}

// Calculate active students per course (from sessions)
function calculateActiveStudents(courseId, sessions) {
  const uniqueStudents = new Set();
  sessions.forEach(session => {
    if (session.status === 'scheduled' || session.status === 'active') {
      uniqueStudents.add(session.enrolledCount);
    }
  });
  return uniqueStudents.size;
}

// Populate courses grid
function populateCourses(courses, sessions) {
  const coursesGrid = document.querySelector('.courses-grid');
  if (!coursesGrid) return;

  if (courses.length === 0) {
    coursesGrid.innerHTML = `
      <div class="empty-state">
        <h3>No Courses</h3>
        <p>You haven't added any courses to tutor yet. Click "Manage Courses" to add one.</p>
      </div>
    `;
    return;
  }

  coursesGrid.innerHTML = courses.map(course => `
    <div class="course-card">
      <div class="course-header">
        <div>
          <h3>${escapeHtml(course.title)}</h3>
          <span class="course-code">${escapeHtml(course.code)}</span>
        </div>
      </div>
      <div class="course-meta">
        ${course.credits ? `<div><strong>Credits:</strong> ${course.credits}</div>` : ''}
        ${course.description ? `<div>${escapeHtml(course.description)}</div>` : ''}
      </div>
      <div class="course-actions">
        <button class="btn btn-secondary" onclick="removeCourse(${course.courseId})">Remove Course</button>
      </div>
    </div>
  `).join('');
}

// Get session status badge class
function getStatusClass(status) {
  switch (status) {
    case 'active':
      return 'status-active';
    case 'scheduled':
      return 'status-upcoming';
    case 'over':
      return 'status-completed';
    default:
      return 'status-upcoming';
  }
}

// Get session status display text
function getStatusText(status) {
  switch (status) {
    case 'active':
      return 'Active';
    case 'scheduled':
      return 'Upcoming';
    case 'over':
      return 'Completed';
    default:
      return 'Scheduled';
  }
}

// Populate sessions grid
function populateSessions(sessions) {
  const sessionsGrid = document.querySelector('.sessions-grid');
  if (!sessionsGrid) return;

  if (sessions.length === 0) {
    sessionsGrid.innerHTML = `
      <div class="empty-state">
        <h3>No Sessions</h3>
        <p>You haven't created any tutoring sessions yet.</p>
      </div>
    `;
    return;
  }

  sessionsGrid.innerHTML = sessions.map(session => {
    const isCompleted = session.status === 'over';
    const primaryBtnText = 'Remove Session';
    const secondaryBtnText = isCompleted ? 'View Feedback' : 'View Enrollments';

    return `
    <div class="session-card">
      <div class="session-header">
        <h3>${escapeHtml(session.title || 'Tutoring Session')}</h3>
        <span class="session-status ${getStatusClass(session.status)}">${getStatusText(session.status)}</span>
      </div>
      <div class="session-info">
        <div class="session-info-item">
          <strong>Course:</strong> ${escapeHtml(session.courseNames)}
        </div>
        <div class="session-info-item">
          <strong>Date:</strong> ${formatDateTime(session.startTime)}
        </div>
        <div class="session-info-item">
          <strong>Time:</strong> ${formatTime(session.startTime)} - ${formatTime(session.endTime)}
        </div>
        ${session.locationDetails ? `
        <div class="session-info-item">
          <strong>Location:</strong> ${escapeHtml(session.locationDetails)}
        </div>` : ''}
        <div class="session-info-item">
          <strong>Enrolled:</strong> ${session.enrolledCount} / ${session.capacity} students
        </div>
      </div>
      <div class="session-actions">
        <button class="btn btn-primary" onclick="removeSession(${session.sessionId})">${primaryBtnText}</button>
        <button class="btn btn-secondary" onclick="viewEnrollments(${session.sessionId})">${secondaryBtnText}</button>
      </div>
    </div>
  `}).join('');
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Show error message
function showError(message) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('dashboardContent').style.display = 'none';
  const errorState = document.getElementById('errorState');
  errorState.style.display = 'block';
  errorState.querySelector('p').textContent = message;
}

// Placeholder functions for button actions
function viewStudents(courseId) {
  console.log('View students for course:', courseId);
}

function editCourse(courseId) {
  console.log('Edit course:', courseId);
}

async function removeSession(sessionId) {
  const confirmed = await showConfirm(
    'Are you sure you want to remove this session? This will also remove all enrollments. This action cannot be undone.',
    'Remove Session'
  );

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    const result = await response.json();

    if (result.success) {
      showMessage('Session removed successfully!', false);
      loadTutorDashboard();
    } else {
      showMessage('Failed to remove session: ' + (result.message || 'Unknown error'), true);
    }
  } catch (error) {
    console.error('Error removing session:', error);
    showMessage('Failed to remove session. Please try again.', true);
  }
}

let currentEnrollmentSessionId = null;

async function viewEnrollments(sessionId) {
  currentEnrollmentSessionId = sessionId;
  document.getElementById('enrollmentsModal').style.display = 'flex';
  document.getElementById('enrollmentsModalBody').innerHTML = '<div class="loading-state">Loading enrollments...</div>';

  try {
    const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/enrollments`, {
      credentials: 'include'
    });

    const result = await response.json();

    if (result.success) {
      renderEnrollments(result.data);
    } else {
      document.getElementById('enrollmentsModalBody').innerHTML = `
        <div class="empty-enrollment">Failed to load enrollments: ${result.message || 'Unknown error'}</div>
      `;
    }
  } catch (error) {
    console.error('Error fetching enrollments:', error);
    document.getElementById('enrollmentsModalBody').innerHTML = `
      <div class="empty-enrollment">Failed to load enrollments. Please try again.</div>
    `;
  }
}

function renderEnrollments(data) {
  document.getElementById('enrollmentsModalTitle').textContent = data.sessionTitle || 'Session Enrollments';

  const fillPercent = Math.min((data.enrolledCount / data.capacity) * 100, 100);
  const isFull = data.enrolledCount >= data.capacity;

  let html = `
    <div class="capacity-info">
      <span><strong>Capacity:</strong> ${data.enrolledCount} / ${data.capacity} students</span>
      <div class="capacity-bar">
        <div class="capacity-fill ${isFull ? 'full' : ''}" style="width: ${fillPercent}%"></div>
      </div>
    </div>
  `;

  // Enrolled Students Section
  html += `
    <div class="enrollment-section">
      <h3>Enrolled Students <span class="enrollment-count">${data.enrolledCount}</span></h3>
  `;

  if (data.enrollments.length > 0) {
    html += '<div class="enrollment-list">';
    data.enrollments.forEach(student => {
      const enrolledDate = new Date(student.enrolled_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      html += `
        <div class="enrollment-item">
          <div class="enrollment-info">
            <span class="enrollment-name">${escapeHtml(student.student_name)}</span>
            <span class="enrollment-email">${escapeHtml(student.email)}</span>
            <span class="enrollment-date">Enrolled: ${enrolledDate}</span>
          </div>
          <div class="enrollment-actions">
            <button class="enrollment-btn remove" onclick="removeStudent(${currentEnrollmentSessionId}, ${student.user_id}, '${escapeHtml(student.student_name)}')">
              Remove
            </button>
          </div>
        </div>
      `;
    });
    html += '</div>';
  } else {
    html += '<div class="enrollment-list"><div class="empty-enrollment">No students enrolled yet</div></div>';
  }

  html += '</div>';

  // Pending Requests Section
  if (data.pendingRequests.length > 0) {
    html += `
      <div class="enrollment-section">
        <h3>Pending Requests <span class="enrollment-count" style="background: #fef3c7; color: #92400e;">${data.pendingRequests.length}</span></h3>
        <div class="enrollment-list">
    `;

    data.pendingRequests.forEach(request => {
      const requestDate = new Date(request.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      html += `
        <div class="enrollment-item">
          <div class="enrollment-info">
            <span class="enrollment-name">${escapeHtml(request.student_name)}</span>
            <span class="enrollment-email">${escapeHtml(request.email)}</span>
            <span class="enrollment-date">Requested: ${requestDate}</span>
          </div>
          <div class="enrollment-actions">
            <button class="enrollment-btn accept" onclick="acceptRequestFromModal(${request.request_id})">
              Accept
            </button>
            <button class="enrollment-btn deny" onclick="denyRequestFromModal(${request.request_id})">
              Deny
            </button>
          </div>
        </div>
      `;
    });

    html += '</div></div>';
  }

  document.getElementById('enrollmentsModalBody').innerHTML = html;
}

function closeEnrollmentsModal() {
  document.getElementById('enrollmentsModal').style.display = 'none';
  currentEnrollmentSessionId = null;
}

async function removeStudent(sessionId, studentId, studentName) {
  const confirmed = await showConfirm(
    `Are you sure you want to remove ${studentName} from this session?`,
    'Remove Student'
  );

  if (!confirmed) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/students/${studentId}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    const result = await response.json();

    if (result.success) {
      showMessage('Student removed successfully!', false);
      viewEnrollments(sessionId); // Refresh the modal
      loadTutorDashboard(); // Refresh dashboard counts
    } else {
      showMessage('Failed to remove student: ' + (result.message || 'Unknown error'), true);
    }
  } catch (error) {
    console.error('Error removing student:', error);
    showMessage('Failed to remove student. Please try again.', true);
  }
}

async function acceptRequestFromModal(requestId) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/session-requests/${requestId}/accept`, {
      method: 'POST',
      credentials: 'include'
    });

    const result = await response.json();

    if (result.success) {
      showMessage(result.message || 'Request accepted!', false);
      if (currentEnrollmentSessionId) {
        viewEnrollments(currentEnrollmentSessionId); // Refresh the modal
      }
      loadTutorDashboard(); // Refresh dashboard counts
    } else {
      showMessage('Failed to accept request: ' + (result.message || 'Unknown error'), true);
    }
  } catch (error) {
    console.error('Error accepting request:', error);
    showMessage('Failed to accept request. Please try again.', true);
  }
}

// Deny reason modal handling
let pendingDenyRequestId = null;

function openDenyReasonModal(requestId) {
  pendingDenyRequestId = requestId;
  document.getElementById('denyReasonText').value = '';
  document.getElementById('denyReasonModal').style.display = 'flex';
  document.getElementById('denyReasonText').focus();
}

function closeDenyReasonModal() {
  document.getElementById('denyReasonModal').style.display = 'none';
  pendingDenyRequestId = null;
}

// Set up the deny confirmation button when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  const denyReasonConfirmBtn = document.getElementById('denyReasonConfirm');
  if (denyReasonConfirmBtn) {
    denyReasonConfirmBtn.onclick = function() {
      if (pendingDenyRequestId) {
        const requestId = pendingDenyRequestId;
        const reason = document.getElementById('denyReasonText').value.trim();
        closeDenyReasonModal();
        executeDenyRequest(requestId, reason);
      }
    };
  }
});

function denyRequestFromModal(requestId) {
  openDenyReasonModal(requestId);
}

async function executeDenyRequest(requestId, reason) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/session-requests/${requestId}/deny`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ reason: reason || '' })
    });

    const result = await response.json();

    if (result.success) {
      showMessage(result.message || 'Request denied', false);
      if (currentEnrollmentSessionId) {
        viewEnrollments(currentEnrollmentSessionId); // Refresh the modal
      }
      loadTutorDashboard(); // Refresh dashboard counts
    } else {
      showMessage('Failed to deny request: ' + (result.message || 'Unknown error'), true);
    }
  } catch (error) {
    console.error('Error denying request:', error);
    showMessage('Failed to deny request. Please try again.', true);
  }
}

// Load dashboard when page loads
document.addEventListener('DOMContentLoaded', loadTutorDashboard);


// Manage Courses Modal Functions
function openManageCourseModal() {
  document.getElementById('manageCourseModal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('manageCourseModal').style.display = 'none';
  const form = document.getElementById('courseForm');
  if (form) form.reset();
}

async function saveCourse() {
  const courseName = document.getElementById('courseName').value;
  const courseCode = document.getElementById('courseCode').value;
  const description = document.getElementById('courseDescription').value;
  
  if (!courseName || !courseCode) {
    showMessage('Please fill in course name and code', true);
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/tutors/courses`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: courseName,
        code: courseCode,
        description: description || null
      })
    });

    const result = await response.json();
    
    if (result.success) {
      showMessage('Course added successfully!', false);
      closeModal();
      loadTutorDashboard();
    } else {
      showMessage('Failed to add course: ' + (result.message || 'Unknown error'), true);
    }
  } catch (error) {
    console.error('Error saving course:', error);
    showMessage('Failed to save course. Please try again.', true);
  }
}

async function removeCourse(courseId) {
  const confirmed = await showConfirm(
      'Are you sure you want to remove this course? This action cannot be undone.',
      'Remove Course'
  );
  
  if (!confirmed) {
      return;
  }

  try {
      const response = await fetch(`${API_BASE_URL}/api/tutors/courses/${courseId}`, {
          method: 'DELETE',
          credentials: 'include'
      });

      const result = await response.json();
      
      if (result.success) {
          showMessage('Course removed successfully!', false);
          loadTutorDashboard();
      } else {
          showMessage('Failed to remove course: ' + (result.message || 'Unknown error'), true);
      }
  } catch (error) {
      console.error('Error removing course:', error);
      showMessage('Failed to remove course. Please try again.', true);
  }
}

// Store current profile data
let currentProfile = null;

// Open edit profile modal
function openEditProfileModal() {
  if (!currentProfile) {
      showMessage('Profile data not loaded yet', true);
      return;
  }

  // Populate form with current data
  document.getElementById('editFirstName').value = currentProfile.firstName || '';
  document.getElementById('editLastName').value = currentProfile.lastName || '';
  document.getElementById('editYearsExperience').value = currentProfile.yearsExperience || 0;
  document.getElementById('editDescription').value = currentProfile.description || '';
  document.getElementById('editBio').value = currentProfile.bio || '';
  
  // Show modal
  document.getElementById('editProfileModal').style.display = 'flex';
}

// Close profile modal
function closeProfileModal() {
    document.getElementById('editProfileModal').style.display = 'none';
    const form = document.getElementById('profileForm');
    if (form) form.reset();
}

// Save profile changes
async function saveProfile() {
  const firstName = document.getElementById('editFirstName').value.trim();
  const lastName = document.getElementById('editLastName').value.trim();
  const yearsExperience = document.getElementById('editYearsExperience').value;
  const description = document.getElementById('editDescription').value.trim();
  const bio = document.getElementById('editBio').value.trim();

  // Validate required fields
  if (!firstName || !lastName) {
      showMessage('First name and last name are required', true);
      return;
  }

  // Validate years of experience
  if (yearsExperience && (parseInt(yearsExperience) < 0 || parseInt(yearsExperience) > 50)) {
      showMessage('Years of experience must be between 0 and 50', true);
      return;
  }

  try {
      const response = await fetch(`${API_BASE_URL}/api/tutors/profile`, {
          method: 'PUT',
          credentials: 'include',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({
              firstName,
              lastName,
              yearsExperience: yearsExperience ? parseInt(yearsExperience) : 0,
              description: description || null,
              bio: bio || null
          })
      });

      const result = await response.json();

      if (result.success) {
          showMessage('Profile updated successfully!', false);
          closeProfileModal();
          loadTutorDashboard();
      } else {
          showMessage('Failed to update profile: ' + (result.message || 'Unknown error'), true);
      }
  } catch (error) {
      console.error('Error updating profile:', error);
      showMessage('Failed to update profile. Please try again.', true);
  }
}

// Update the editCourse function to open the modal with course data
async function editCourse(courseId) {
  // TODO: Fetch course details and populate form
  console.log('Edit course:', courseId);
  openManageCourseModal();
  // You can add logic here to fetch and populate the form with existing course data
}


// ========== SESSION CREATION FUNCTIONS ==========

// Open the create session modal
function openCreateSessionModal() {
  // Populate course checkboxes
  const courseContainer = document.getElementById('sessionCourses');
  courseContainer.innerHTML = '';

  if (tutorCourses.length === 0) {
    showMessage('Please add at least one course before creating a session.', true);
    return;
  }

  tutorCourses.forEach(course => {
    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.style.display = 'flex';
    checkboxWrapper.style.alignItems = 'center';
    checkboxWrapper.style.padding = '0.5rem 0';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `course_${course.courseId}`;
    checkbox.value = course.courseId;
    checkbox.className = 'course-checkbox';
    checkbox.style.width = '18px';
    checkbox.style.height = '18px';
    checkbox.style.marginRight = '0.75rem';
    checkbox.style.cursor = 'pointer';
    checkbox.style.flexShrink = '0';

    const label = document.createElement('label');
    label.htmlFor = `course_${course.courseId}`;
    label.textContent = course.code;
    label.style.cursor = 'pointer';
    label.style.fontSize = '0.95rem';

    checkboxWrapper.appendChild(checkbox);
    checkboxWrapper.appendChild(label);
    courseContainer.appendChild(checkboxWrapper);
  });

  // Set minimum date to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('sessionDate').min = today;
  document.getElementById('sessionDate').value = '';

  // Reset form
  document.getElementById('sessionForm').reset();
  document.getElementById('sessionCapacity').value = 1;

  // Re-populate checkboxes after reset (since reset clears them)
  tutorCourses.forEach(course => {
    const checkbox = document.getElementById(`course_${course.courseId}`);
    if (checkbox) checkbox.checked = false;
  });

  // Show modal
  document.getElementById('createSessionModal').style.display = 'flex';
}

// Close the create session modal
function closeSessionModal() {
  document.getElementById('createSessionModal').style.display = 'none';
  document.getElementById('sessionForm').reset();
}

// Handle session type change - auto-adjust capacity
function handleSessionTypeChange() {
  const sessionType = document.getElementById('sessionType').value;
  const capacityInput = document.getElementById('sessionCapacity');

  if (sessionType === 'one_on_one') {
    capacityInput.value = 1;
    capacityInput.max = 1;
    capacityInput.disabled = true;
  } else {
    capacityInput.value = 5;
    capacityInput.max = 50;
    capacityInput.disabled = false;
  }
}

// Create a new session
async function createSession() {
  const sessionTitle = document.getElementById('sessionTitle').value;
  const sessionType = document.getElementById('sessionType').value;

  // Collect checked courses
  const checkboxes = document.querySelectorAll('.course-checkbox:checked');
  const courseIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

  const sessionDate = document.getElementById('sessionDate').value;
  const startTime = document.getElementById('sessionStartTime').value;
  const endTime = document.getElementById('sessionEndTime').value;
  const capacity = document.getElementById('sessionCapacity').value;
  const location = document.getElementById('sessionLocation').value;

  // Validate required fields
  if (!sessionTitle.trim()) {
    showMessage('Please enter a title for this session.', true);
    return;
  }

  if (courseIds.length === 0) {
    showMessage('Please select at least one course for this session.', true);
    return;
  }

  if (!sessionDate) {
    showMessage('Please select a date for this session.', true);
    return;
  }

  if (!startTime || !endTime) {
    showMessage('Please select start and end times.', true);
    return;
  }

  if (!location.trim()) {
    showMessage('Please enter a location for this session.', true);
    return;
  }

  // Validate end time is after start time
  if (endTime <= startTime) {
    showMessage('End time must be after start time.', true);
    return;
  }

  // Create datetime strings
  const startDateTime = `${sessionDate}T${startTime}:00`;
  const endDateTime = `${sessionDate}T${endTime}:00`;

  // Validate session is in the future
  const now = new Date();
  const sessionStart = new Date(startDateTime);
  if (sessionStart <= now) {
    showMessage('Session must be scheduled in the future.', true);
    return;
  }

  // Disable button while saving
  const createBtn = document.getElementById('createSessionBtn');
  const originalText = createBtn.textContent;
  createBtn.textContent = 'Creating...';
  createBtn.disabled = true;

  try {
    const response = await fetch(`${API_BASE_URL}/api/sessions`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: sessionTitle.trim(),
        sessionType: sessionType,
        courseIds: courseIds,
        startTime: startDateTime,
        endTime: endDateTime,
        capacity: parseInt(capacity),
        locationDetails: location.trim()
      })
    });

    const result = await response.json();

    if (result.success) {
      showMessage('Session created successfully!', false);
      closeSessionModal();
      loadTutorDashboard(); // Refresh the dashboard to show new session
    } else {
      showMessage('Failed to create session: ' + (result.message || 'Unknown error'), true);
    }
  } catch (error) {
    console.error('Error creating session:', error);
    showMessage('Failed to create session. Please try again.', true);
  } finally {
    createBtn.textContent = originalText;
    createBtn.disabled = false;
  }
}
