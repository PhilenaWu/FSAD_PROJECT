// Dummy env vars so config/env passes validation under test. Real DB/Supabase/
// Cloudinary are mocked in the integration tests, so these values are never used
// to reach a real service. Set before dotenv runs so they aren't overridden.
process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL ||= 'http://localhost';
process.env.DATABASE_URL ||= 'postgres://test';
process.env.SUPABASE_URL ||= 'https://test.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY ||= 'test-key';
process.env.CLOUDINARY_CLOUD_NAME ||= 'test';
process.env.CLOUDINARY_API_KEY ||= 'test';
process.env.CLOUDINARY_API_SECRET ||= 'test';
