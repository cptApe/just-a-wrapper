import { expect, test } from '@playwright/test';

// The sign-in surfaces in a real browser. Deeper flows (OTP, Google) need real auth infra, so the
// OTP send is mocked where a test needs it.

const SEND_OTP = '**/api/auth/email-otp/send-verification-otp';

test('a signed-out visitor to /app lands on a working sign-in form', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login(\?.*)?$/);
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await expect(page.getByPlaceholder('Enter email address')).toBeVisible();
  await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
});

test('a throttled code send shows the reason and leaves Continue usable', async ({ page }) => {
  await page.route(SEND_OTP, (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: '{"message":"Too many requests. Please try again later."}',
    }),
  );
  await page.goto('/login');
  await page.getByPlaceholder('Enter email address').fill('throttle-probe@example.com');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Too many emails sent to this address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
});
