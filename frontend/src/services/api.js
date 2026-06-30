// Axios instance for the backend REST API. Attaches the Supabase access token
// as a Bearer header on every request; the backend validates it.
import axios from 'axios';
import { getAccessToken } from '../lib/auth';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

api.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
