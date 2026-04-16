(async function() {
    const path = window.location.pathname;

    // List of pages that require authentication
    const protectedPages = [
        'dashboard.html',
        'profile.html',
        'wallet.html',
        'review.html',
        'spin.html'
    ];

    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return '';
    }

    window.getCsrfToken = () => getCookie('csrf_token');
    window.authFetch = (url, options = {}) => {
        const headers = { ...(options.headers || {}) };
        const method = (options.method || 'GET').toUpperCase();
        if (method !== 'GET') {
            headers['x-csrf-token'] = window.getCsrfToken();
            if (!headers['x-idempotency-key']) {
                headers['x-idempotency-key'] = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            }
        }
        return fetch(url, {
            credentials: 'include',
            ...options,
            headers
        });
    };

    const isProtected = protectedPages.some(p => path.includes(p));

    if (isProtected) {
        try {
            const res = await fetch('/api/user/profile', { credentials: 'include' });
            if (!res.ok) {
                window.location.href = 'login.html';
                return;
            }
            if (!window.getCsrfToken()) {
                await fetch('/api/auth/csrf', { credentials: 'include' });
            }
        } catch (e) {
            window.location.href = 'login.html';
            return;
        }
    }

    // Global logout function
    window.logout = () => {
        window.authFetch('/api/auth/logout', { method: 'POST' }).finally(() => {
            window.location.href = 'login.html';
        });
    };
})();
