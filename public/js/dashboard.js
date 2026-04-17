// dashboard.js

// Function to fetch user profile
async function fetchUserProfile() {
    try {
        const response = await fetch('/api/user/profile');
        if (!response.ok) {
            throw new Error('Network response was not ok ' + response.statusText);
        }
        const data = await response.json();
        displayUserData(data);
    } catch (error) {
        handleError(error);
    }
}

// Function to display user data
function displayUserData(data) {
    const userInfo = `\nName: ${data.name} \nEmail: ${data.email} \nWallet Balance: ${data.wallet_balance} \nCredit Score: ${data.credit_score} \nKYC Status: ${data.kyc_status}`;
    document.getElementById('user-data').innerText = userInfo;
}

// Function to handle errors
function handleError(error) {
    const errorMsg = `Error: ${error.message}`;
    document.getElementById('error-message').innerText = errorMsg;
}

// Function to handle logout
function logout() {
    window.logout();
}

// Setup main navigation menu
function setupNavigation() {
    const nav = document.getElementById('main-nav');
    nav.innerHTML = `\n<a href='wallet.html'>Wallet</a>\n<a href='review.html'>Review</a>\n<a href='spin.html'>Spin</a>\n<a href='profile.html'>Profile</a>\n<button onclick='logout()'>Logout</button>`;
}

// Initialize the dashboard
function initDashboard() {
    setupNavigation();
    fetchUserProfile();
}

// Call initialization function on page load
window.onload = initDashboard;