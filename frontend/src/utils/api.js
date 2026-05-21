import axios from 'axios';

// In production, set VITE_API_URL to your backend URL (e.g. https://your-app.up.railway.app)
// In development, Vite proxy handles /api → localhost:5000
const baseURL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const api = axios.create({
  baseURL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
});

// Attach JWT token to every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('icf_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 globally
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('icf_token');
      localStorage.removeItem('icf_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
