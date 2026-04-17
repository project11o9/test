'use strict';

class ApiClient {
    constructor(baseURL) {
        this.baseURL = baseURL;
        this.token = null;  // Initialize auth token
        this.loading = false; // Loading state
    }

    setToken(token) {
        this.token = token; // Set the auth token
    }

    async request(url, options = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        options.headers = { ...headers, ...options.headers };

        this.loading = true; // Set loading state to true
        try {
            const response = await fetch(`${this.baseURL}${url}`, options);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error('API Request Failed:', error);
            throw error;
        } finally {
            this.loading = false; // Reset loading state
        }
    }

    get(url) {
        return this.request(url);
    }

    post(url, data) {
        return this.request(url, { method: 'POST', body: JSON.stringify(data) });
    }

    put(url, data) {
        return this.request(url, { method: 'PUT', body: JSON.stringify(data) });
    }

    delete(url) {
        return this.request(url, { method: 'DELETE' });
    }
}

// Example usage:
// const apiClient = new ApiClient('https://api.example.com');
// apiClient.setToken('your-auth-token');
// apiClient.get('/endpoint').then(data => console.log(data));
