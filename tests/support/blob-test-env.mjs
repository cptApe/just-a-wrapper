Object.assign(process.env, {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  BETTER_AUTH_SECRET: 'test-secret-with-at-least-thirty-two-characters',
  GOOGLE_CLIENT_ID: 'test',
  GOOGLE_CLIENT_SECRET: 'test',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_teststore_testsecret',
});
