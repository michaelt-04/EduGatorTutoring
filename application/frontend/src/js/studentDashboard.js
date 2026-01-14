/**
 * Student Dashboard - Loads and displays student data from the database
 */

const API_BASE_URL = window.location.origin;

// Store all courses for toggle functionality
let allCourses = [];
let showingAllCourses = false;

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

// Manage Course Modal Functions
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
  const credits = document.getElementById('courseCredits').value;
  const instructor = document.getElementById('instructorName').value;
  let schedule = document.getElementById('courseSchedule').value;
  const termLabel = document.getElementById('termLabel').value;
  const status = document.getElementById('courseStatus').value;

  // Build schedule from checkboxes and times if not manually entered
  if (!schedule) {
    const selectedDays = Array.from(document.querySelectorAll('input[name="courseDays"]:checked'))
      .map(cb => cb.value)
      .join('');
    const startTime = document.getElementById('courseStartTime').value;
    const endTime = document.getElementById('courseEndTime').value;

    if (selectedDays && startTime && endTime) {
      schedule = `${selectedDays} ${startTime}-${endTime}`;
    }
  }

    // Validate schedule format if provided
    if (schedule) {
      const schedulePattern = /^[MTWRFSU]+\s+\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/i;
      if (!schedulePattern.test(schedule)) {
        showMessage('Invalid schedule format. Use format like "MWF 10:00-11:00" or "TR 14:00-15:30"', true);
        return;
      }
      
      // Validate time logic
      const [, days, startHour, startMin, dash, endHour, endMin] = schedule.match(/([MTWRFSU]+)\s+(\d{1,2}):(\d{2})(\s*-\s*)(\d{1,2}):(\d{2})/i);
      const startMinutes = parseInt(startHour) * 60 + parseInt(startMin);
      const endMinutes = parseInt(endHour) * 60 + parseInt(endMin);
      
      if (endMinutes <= startMinutes) {
        showMessage('End time must be after start time', true);
        return;
      }
    }

  // Validate required fields
  if (!courseName || !courseCode) {
      showMessage('Please fill in course name and code', true);
      return;
  }

  try {
      const response = await fetch(`${API_BASE_URL}/api/students/courses`, {
          method: 'POST',
          credentials: 'include',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({
              title: courseName,
              code: courseCode,
              credits: credits ? parseInt(credits) : null,
              instructor: instructor || null,
              schedule: schedule || null,
              termLabel: termLabel || null,
              status: status
          })
      });

      const result = await response.json();

      if (result.success) {
          showMessage('Course added successfully!', false);
          closeModal();
          loadStudentDashboard();
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
      const response = await fetch(`${API_BASE_URL}/api/students/courses/${courseId}`, {
          method: 'DELETE',
          credentials: 'include'
      });

      const result = await response.json();

      if (result.success) {
          showMessage('Course removed successfully!', false);
          loadStudentDashboard();
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
    document.getElementById('editMajor').value = currentProfile.major || '';
    document.getElementById('editGpa').value = currentProfile.gpa || '';
    
    // Format graduation date to MM/YYYY
    if (currentProfile.expectedGraduation) {
        // Add T12:00:00 to avoid timezone shift issues
        const date = new Date(currentProfile.expectedGraduation + 'T12:00:00');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        document.getElementById('editGraduationDate').value = `${month}/${year}`;
    } else {
        document.getElementById('editGraduationDate').value = '';
    }
    
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
    const major = document.getElementById('editMajor').value.trim();
    const gpa = document.getElementById('editGpa').value;
    const graduationDateInput = document.getElementById('editGraduationDate').value.trim();
    const bio = document.getElementById('editBio').value.trim();

    // Validate required fields
    if (!firstName || !lastName) {
        showMessage('First name and last name are required', true);
        return;
    }

    // Parse MM/YYYY format to date
    let graduationDate = null;
    if (graduationDateInput) {
        const parts = graduationDateInput.split('/');
        if (parts.length === 2 && parts[0].length === 2 && parts[1].length === 4) {
            const month = parts[0];
            const year = parts[1];
            graduationDate = `${year}-${month}-01`;
        } else {
            showMessage('Graduation date must be in MM/YYYY format', true);
            return;
        }
    }

    // Validate GPA if provided
    if (gpa && (parseFloat(gpa) < 0 || parseFloat(gpa) > 4)) {
        showMessage('GPA must be between 0.00 and 4.00', true);
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/students/profile`, {
            method: 'PUT',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                firstName,
                lastName,
                major: major || null,
                gpa: gpa ? parseFloat(gpa) : null,
                graduationDate: graduationDate,
                bio: bio || null
            })
        });

        const result = await response.json();

        if (result.success) {
            showMessage('Profile updated successfully!', false);
            closeProfileModal();
            loadStudentDashboard();
        } else {
            showMessage('Failed to update profile: ' + (result.message || 'Unknown error'), true);
        }
    } catch (error) {
        console.error('Error updating profile:', error);
        showMessage('Failed to update profile. Please try again.', true);
    }
}

// Format graduation date input (MM/YYYY)
document.addEventListener('DOMContentLoaded', () => {
    const graduationInput = document.getElementById('editGraduationDate');
    if (graduationInput) {
        graduationInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length >= 2) {
                value = value.slice(0, 2) + '/' + value.slice(2, 6);
            }
            e.target.value = value;
        });
    }
});

// Format date for display
function formatDate(dateString) {
  if (!dateString) return 'Not set';
  // Parse as local date to avoid timezone shift issues
  // dateString is in format "YYYY-MM-DD" - adding T12:00:00 prevents day shift
  const date = new Date(dateString + 'T12:00:00');
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Format academic level
function formatAcademicLevel(level) {
  if (!level) return '';
  return level.charAt(0).toUpperCase() + level.slice(1);
}

// Load and populate student dashboard
async function loadStudentDashboard() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/dashboard/student`, {
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
  const { profile, courses, stats } = data;

  // Store profile data for editing
  currentProfile = profile;

  // Store all courses for toggle functionality
  allCourses = courses;
  showingAllCourses = false;
  updateViewAllButton();

  // Update profile header
  const nameElement = document.querySelector('.profile-info h1');
  if (nameElement) {
    nameElement.textContent = `${profile.firstName} ${profile.lastName}`;
  }

  const subtitleElement = document.querySelector('.profile-subtitle');
  if (subtitleElement) {
    const major = profile.major || 'Undeclared';
    const level = formatAcademicLevel(profile.academicLevel);
    subtitleElement.textContent = level ? `${major} • ${level}` : major;
  }

  // Update profile info grid
  updateInfoItem('Email', profile.email);
  updateInfoItem('Expected Graduation', formatDate(profile.expectedGraduation));
  updateInfoItem('GPA', profile.gpa ? profile.gpa.toFixed(2) : 'N/A');

  // Update bio
  const bioElement = document.querySelector('.bio-text');
  if (bioElement) {
    bioElement.textContent = profile.bio || 'No bio added yet.';
  }

  // Update stats
  updateStat('Courses Enrolled', stats.coursesEnrolled);
  updateStat('Total Credits', stats.totalCredits);
  updateStat('Tutoring Sessions', stats.tutoringSessions);

  // Update courses
  populateCourses(courses);
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

// Get status badge HTML
function getStatusBadge(status) {
  const statusConfig = {
    current: { label: 'Current', class: 'status-current' },
    planned: { label: 'Planned', class: 'status-planned' },
    completed: { label: 'Completed', class: 'status-completed' }
  };
  const config = statusConfig[status] || statusConfig.current;
  return `<span class="course-status-badge ${config.class}">${config.label}</span>`;
}

// Toggle view all courses
function toggleViewAllCourses() {
  showingAllCourses = !showingAllCourses;
  updateViewAllButton();
  populateCourses(allCourses);
}

// Update the View All button text
function updateViewAllButton() {
  const viewAllLink = document.querySelector('.view-all-link');
  if (viewAllLink) {
    viewAllLink.textContent = showingAllCourses
      ? 'Hide Planned/Completed'
      : 'View All Courses';
  }
}

// Populate courses grid
function populateCourses(courses) {
  const coursesGrid = document.querySelector('.courses-grid');
  if (!coursesGrid) return;

  // Filter based on toggle state
  let displayCourses;
  if (showingAllCourses) {
    // Sort by status: current first, then planned, then completed
    displayCourses = [...courses].sort((a, b) => {
      const order = { current: 1, planned: 2, completed: 3 };
      return (order[a.status] || 4) - (order[b.status] || 4);
    });
  } else {
    displayCourses = courses.filter(c => c.status === 'current');
  }

  if (displayCourses.length === 0) {
    const message = showingAllCourses
      ? 'You have no courses yet. Click "Add Courses" to enroll.'
      : 'You are not enrolled in any current courses. Click "Add Courses" to enroll.';
    coursesGrid.innerHTML = `
      <div class="empty-state">
        <h3>No Courses</h3>
        <p>${message}</p>
      </div>
    `;
    return;
  }

  coursesGrid.innerHTML = displayCourses.map(course => `
    <div class="course-card">
      <div class="course-header">
        <div>
          <h3>${escapeHtml(course.title)}</h3>
          <span class="course-code">${escapeHtml(course.code)}</span>
        </div>
        ${showingAllCourses ? getStatusBadge(course.status) : ''}
      </div>
      <div class="course-meta">
        ${course.instructor ? `<div><strong>Instructor:</strong> ${escapeHtml(course.instructor)}</div>` : ''}
        ${course.schedule ? `<div><strong>Schedule:</strong> ${escapeHtml(course.schedule)}</div>` : ''}
        ${course.termLabel ? `<div><strong>Term:</strong> ${escapeHtml(course.termLabel)}</div>` : ''}
        ${course.credits ? `<div><strong>Credits:</strong> ${course.credits}</div>` : ''}
      </div>
      <div class="course-actions">
        <button class="btn btn-secondary" onclick="removeCourse(${course.courseId})">Remove Course</button>
      </div>
    </div>
  `).join('');
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
function viewCourse(courseId) {
  console.log('View course:', courseId);
}

function findTutor(courseId) {
  console.log('Find tutor for course:', courseId);
  window.location.href = `search.html?course=${courseId}`;
}

// Format date and time for sessions
function formatSessionDateTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

// Get session status badge HTML
function getSessionStatusBadge(status) {
  const statusConfig = {
    scheduled: { label: 'Scheduled', class: 'session-status-scheduled' },
    active: { label: 'Active', class: 'session-status-active' },
    over: { label: 'Completed', class: 'session-status-over' }
  };
  const config = statusConfig[status] || statusConfig.scheduled;
  return `<span class="session-status-badge ${config.class}">${config.label}</span>`;
}

// Load enrolled sessions
async function loadEnrolledSessions() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/students/enrolled-sessions`, {
      credentials: 'include'
    });

    if (!response.ok) {
      if (response.status === 401) {
        return; // Not logged in, don't show error
      }
      throw new Error('Failed to load enrolled sessions');
    }

    const result = await response.json();
    if (result.success) {
      populateEnrolledSessions(result.data);
    }
  } catch (error) {
    console.error('Error loading enrolled sessions:', error);
  }
}

// Populate enrolled sessions grid
function populateEnrolledSessions(sessions) {
  const sessionsGrid = document.getElementById('enrolledSessionsGrid');
  if (!sessionsGrid) return;

  if (!sessions || sessions.length === 0) {
    sessionsGrid.innerHTML = `
      <div class="empty-state">
        <h3>No Enrolled Sessions</h3>
        <p>You are not currently enrolled in any tutoring sessions.</p>
      </div>
    `;
    return;
  }

  sessionsGrid.innerHTML = sessions.map(session => `
    <div class="session-card">
      <div class="course-header">
        <div>
          <h3>${escapeHtml(session.title)}</h3>
          <span class="session-tutor">with ${escapeHtml(session.tutor_name)}</span>
        </div>
      </div>
      <div class="session-meta">
        <div><strong>Start:</strong> ${formatSessionDateTime(session.start_time)}</div>
        <div><strong>End:</strong> ${formatSessionDateTime(session.end_time)}</div>
        ${session.location_details ? `<div><strong>Location:</strong> ${escapeHtml(session.location_details)}</div>` : ''}
        <div><strong>Capacity:</strong> ${session.enrolled_count}/${session.capacity} students</div>
      </div>
      ${session.course_names ? `
        <div class="session-courses">
          ${session.course_names.split(', ').map(course => `<span class="session-course-pill">${escapeHtml(course)}</span>`).join('')}
        </div>
      ` : ''}
      <div class="course-actions">
        <button class="btn btn-primary" onclick="viewSession(${session.session_id})">View Session</button>
        <button class="btn btn-danger" onclick="unenrollFromSession(${session.session_id}, '${escapeHtml(session.title).replace(/'/g, "\\'")}')">Unenroll</button>
      </div>
    </div>
  `).join('');
}

// View session page
function viewSession(sessionId) {
  window.location.href = `session.html?id=${sessionId}`;
}

// Unenroll from a session
async function unenrollFromSession(sessionId, sessionTitle) {
  const confirmed = await showConfirm(
    `Are you sure you want to unenroll from "${sessionTitle}"? The tutor will be notified.`,
    'Unenroll from Session'
  );

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/unenroll`, {
      method: 'DELETE',
      credentials: 'include'
    });

    const result = await response.json();

    if (result.success) {
      showMessage('Successfully unenrolled from the session', false);
      loadEnrolledSessions(); // Refresh the sessions list
      // Update the Tutoring Sessions stat counter
      const statCards = document.querySelectorAll('.stat-card');
      statCards.forEach(card => {
        const labelElement = card.querySelector('.stat-label');
        if (labelElement && labelElement.textContent === 'Tutoring Sessions') {
          const numberElement = card.querySelector('.stat-number');
          if (numberElement) {
            const currentCount = parseInt(numberElement.textContent) || 0;
            numberElement.textContent = Math.max(0, currentCount - 1);
          }
        }
      });
    } else {
      showMessage('Failed to unenroll: ' + (result.message || 'Unknown error'), true);
    }
  } catch (error) {
    console.error('Error unenrolling from session:', error);
    showMessage('Failed to unenroll from session. Please try again.', true);
  }
}

// Load dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
  loadStudentDashboard();
  loadEnrolledSessions();
});
