(function() {
    const token = localStorage.getItem('token');
    const path = window.location.pathname;

    // List of pages that require authentication
    const protectedPages = [
        'dashboard.html',
        'profile.html',
        'wallet.html',
        'review.html',
        'spin.html'
    ];

    const isProtected = protectedPages.some(p => path.includes(p));

    if (isProtected && !token) {
        window.location.href = 'login.html';
    }

    // Global logout function
    window.logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // Clear cookie
        document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        window.location.href = 'login.html';
    };
})();
