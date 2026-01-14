/**
 * Authentication utility for managing user session and nav bar state
 */

const AUTH_API_URL = `${window.location.origin}/api/auth`;

/**
 * Update inbox badge with unread message count
 */
async function updateInboxBadge(inboxNavItem) {
    try {
        const response = await fetch(`${window.location.origin}/api/messages/unread-count`, {
            credentials: 'include'
        });
        const data = await response.json();

        if (data.success) {
            const count = parseInt(data.unreadCount) || 0;

            // Find or create badge element
            let badge = inboxNavItem.querySelector('.inbox-badge');

            if (count > 0) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'inbox-badge';
                    badge.style.cssText = `
                        position: absolute;
                        top: -5px;
                        right: -5px;
                        background: #ef4444;
                        color: white;
                        font-size: 0.7rem;
                        font-weight: bold;
                        padding: 2px 6px;
                        border-radius: 10px;
                        min-width: 18px;
                        text-align: center;
                    `;
                    // Make parent position relative for absolute positioning
                    inboxNavItem.style.position = 'relative';
                    inboxNavItem.appendChild(badge);
                }
                badge.textContent = count > 99 ? '99+' : count;
                badge.style.display = 'inline-block';
            } else if (badge) {
                badge.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error fetching unread count:', error);
    }
}

/**
 * Show a toast notification message
 */
function showAuthToast(message, type = 'info') {
    // Create toast element if it doesn't exist
    let toast = document.getElementById('auth-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'auth-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 2rem;
            left: 50%;
            transform: translateX(-50%) translateY(100px);
            padding: 1rem 2rem;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 9999;
            opacity: 0;
            transition: transform 0.3s ease, opacity 0.3s ease;
            max-width: 90%;
            text-align: center;
            color: white;
        `;
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#2f4ba5';

    // Trigger show animation
    void toast.offsetWidth;
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.opacity = '1';

    setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(100px)';
        toast.style.opacity = '0';
    }, 4000);
}

// Global user state
let currentUser = null;

/**
 * Get cached auth state from localStorage
 * Only stores minimal data: isLoggedIn flag and user role
 */
function getCachedAuthState() {
    try {
        const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
        const userRole = localStorage.getItem('userRole');

        if (isLoggedIn && userRole) {
            // Return minimal user object for nav bar rendering
            return { role: userRole };
        }
        return null;
    } catch (error) {
        console.error('Error reading cached auth state:', error);
        return null;
    }
}

/**
 * Save minimal auth state to localStorage
 * Only stores isLoggedIn flag and user role (for dashboard routing)
 */
function cacheAuthState(user) {
    try {
        if (user && user.role) {
            localStorage.setItem('isLoggedIn', 'true');
            localStorage.setItem('userRole', user.role);
        } else {
            localStorage.removeItem('isLoggedIn');
            localStorage.removeItem('userRole');
        }
    } catch (error) {
        console.error('Error caching auth state:', error);
    }
}

/**
 * Check if user is logged in
 */
async function checkAuthStatus() {
    try {
        const response = await fetch(`${AUTH_API_URL}/me`, {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success && data.user) {
                currentUser = data.user;
                cacheAuthState(currentUser); // Cache minimal auth state
                return currentUser;
            }
        }
        currentUser = null;
        cacheAuthState(null); // Clear cache
        return null;
    } catch (error) {
        console.error('Auth check failed:', error);
        currentUser = null;
        cacheAuthState(null); // Clear cache
        return null;
    }
}

/**
 * Update navigation bar based on authentication status
 */
async function updateNavBar() {
    const navMenu = document.querySelector('.nav-menu');

    // Find the login nav item
    let loginNavItem = null;
    if (navMenu) {
        loginNavItem = Array.from(navMenu.children).find(item => {
            const link = item.querySelector('.nav-link');
            return link && (link.textContent.trim() === 'Login' || link.textContent.trim() === 'Logout');
        });
    }

    // First, check cached auth state for instant update (no flicker)
    const cachedAuthState = getCachedAuthState();
    if (cachedAuthState && navMenu && loginNavItem) {
        updateNavBarLoggedIn(navMenu, loginNavItem, cachedAuthState);
    }

    // ALWAYS verify with API to ensure cache is updated with current role
    const user = await checkAuthStatus();

    // If we don't have nav elements, at least the cache is now updated
    if (!navMenu || !loginNavItem) return;

    // Only update if the state changed (prevents unnecessary re-renders)
    const isCurrentlyLoggedIn = !!cachedAuthState;
    const shouldBeLoggedIn = !!user;

    if (isCurrentlyLoggedIn !== shouldBeLoggedIn) {
        // State changed - update nav bar
        if (user) {
            updateNavBarLoggedIn(navMenu, loginNavItem, user);
        } else {
            updateNavBarLoggedOut(navMenu, loginNavItem);
        }
    } else if (user && cachedAuthState && user.role !== cachedAuthState.role) {
        // User is still logged in but role changed - update nav bar
        updateNavBarLoggedIn(navMenu, loginNavItem, user);
    }
    // Otherwise, cached state is correct - no need to update again
}

/**
 * Update nav bar for logged-in state
 */
function updateNavBarLoggedIn(navMenu, loginNavItem, user) {
    // Update data-auth attribute for logged-in state
    document.documentElement.setAttribute('data-auth', 'in');

    // Determine dashboard filename based on role
    let dashboardFilename = 'studentDashboard.html';
    if (user.role === 'Tutor') {
        dashboardFilename = 'tutorDashboard.html';
    }

    // Create absolute URL to dashboard (works from any folder depth)
    const dashboardPath = `${window.location.origin}/${dashboardFilename}`;
    const inboxPath = `${window.location.origin}/inbox.html`;

    // Update Inbox placeholder
    const inboxNavItem = document.getElementById('inbox-placeholder');
    if (inboxNavItem) {
        const inboxLink = inboxNavItem.querySelector('.nav-link');
        if (inboxLink) {
            inboxLink.href = inboxPath;
        }
        // Fetch and display unread message count
        updateInboxBadge(inboxNavItem);
    }

    // Update Profile placeholder 
    const profileNavItem = document.getElementById('profile-placeholder');
    if (profileNavItem) {
        const profileLink = profileNavItem.querySelector('.nav-link');
        if (profileLink) {
            profileLink.href = dashboardPath;
        }
    }

    // Change Login to Logout
    loginNavItem.className = 'nav-item nav-auth-in';
    const logoutLink = loginNavItem.querySelector('.nav-link');
    logoutLink.textContent = 'Logout';
    logoutLink.href = '#';

    const newLogoutLink = logoutLink.cloneNode(true);
    logoutLink.parentNode.replaceChild(newLogoutLink, logoutLink);

    // Add logout click handler
    newLogoutLink.addEventListener('click', async (e) => {
        e.preventDefault();
        await handleLogout();
    });
}

/**
 * Update nav bar for logged-out state
 */
function updateNavBarLoggedOut(navMenu, loginNavItem) {
    // Update data-auth attribute for logged-out state (CSS will hide auth-in items)
    document.documentElement.setAttribute('data-auth', 'out');

    // No need to remove Inbox/Profile - they're permanent placeholders hidden by CSS

    // Change Logout to Login and restore nav-auth-out class
    loginNavItem.className = 'nav-item nav-auth-out';
    const loginLink = loginNavItem.querySelector('.nav-link');
    loginLink.textContent = 'Login';

    // Use absolute URL to login page (works from any folder depth)
    loginLink.href = `${window.location.origin}/auth/login.html`;

    // Remove logout event listener by cloning
    const newLoginLink = loginLink.cloneNode(true);
    loginLink.parentNode.replaceChild(newLoginLink, loginLink);
}

/**
 * Handle logout
 */
async function handleLogout() {
    try {
        const response = await fetch(`${AUTH_API_URL}/logout`, {
            method: 'POST',
            credentials: 'include'
        });

        if (response.ok) {
            // Clear current user and cache
            currentUser = null;
            cacheAuthState(null);

            // Update nav bar to logged-out state
            await updateNavBar();

            // Redirect to home page using absolute URL (works from any folder depth)
            window.location.href = `${window.location.origin}/index.html`;
        } else {
            console.error('Logout failed');
            showAuthToast('Logout failed. Please try again.', 'error');
        }
    } catch (error) {
        console.error('Logout error:', error);
        showAuthToast('Logout failed. Please try again.', 'error');
    }
}

/**
 * Get current user
 */
function getCurrentUser() {
    return currentUser;
}

/**
 * Require authentication - redirect to login if not logged in
 */
async function requireAuth() {
    const user = await checkAuthStatus();
    if (!user) {
        // Redirect to login using absolute URL (works from any folder depth)
        window.location.href = `${window.location.origin}/auth/login.html`;
        return false;
    }
    return true;
}

/**
 * Require specific role - redirect if user doesn't have required role
 */
async function requireRole(requiredRole) {
    const user = await checkAuthStatus();
    if (!user || user.role !== requiredRole) {
        // Redirect to home using absolute URL (works from any folder depth)
        window.location.href = `${window.location.origin}/index.html`;
        return false;
    }
    return true;
}

// Initialize auth state when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateNavBar);
} else {
    updateNavBar();
}

/**
 * Refresh the inbox badge count (can be called from other pages)
 */
async function refreshInboxBadge() {
    const inboxNavItem = document.getElementById('inbox-placeholder');
    if (inboxNavItem) {
        await updateInboxBadge(inboxNavItem);
    }
}

// Export functions for use in other scripts
window.authUtils = {
    checkAuthStatus,
    updateNavBar,
    handleLogout,
    getCurrentUser,
    requireAuth,
    requireRole,
    refreshInboxBadge
};
