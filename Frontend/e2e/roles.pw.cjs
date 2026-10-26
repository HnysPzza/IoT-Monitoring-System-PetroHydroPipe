const { test, expect } = require('@playwright/test')

const roles = [
  { id: 'admin', name: 'Admin' },
  { id: 'operations', name: 'Operation Manager' },
  { id: 'assistant', name: 'Asst. Operation Manager' },
  { id: 'engineering', name: 'Engineering Supervisor' },
  { id: 'production', name: 'Production Supervisor' },
]

async function stubApi(page) {
  await page.route('http://localhost:3000/**', async (route) => {
    const { pathname } = new URL(route.request().url())

    if (pathname === '/api/auth/refresh') {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' } }),
      })
      return
    }

    if (pathname === '/api/users/roles') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ roles }) })
      return
    }

    if (pathname === '/api/users') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          users: [{
            id: 'protected-admin',
            name: 'System Administrator',
            username: 'admin',
            email: 'admin@example.test',
            role: 'Admin',
            status: 'Active',
            onboarding: 'Ready',
            createdAt: '2026-10-01T00:00:00.000Z',
            lastLoginAt: null,
          }],
          total: 1,
          summary: { total: 1, active: 1, inactive: 0, pending: 0 },
        }),
      })
      return
    }

    if (pathname.endsWith('/stream')) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' })
      return
    }

    await route.fulfill({ contentType: 'application/json', body: '{}' })
  })
}

async function login(page, username) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('textbox', { name: 'Password' }).fill('password123')
  await page.getByRole('button', { name: 'Sign In' }).click()
}

test.beforeEach(async ({ page }) => {
  await stubApi(page)
})

test('Admin displays as Managing Director and stays unavailable for account assignment', async ({ page }) => {
  await login(page, 'admin')
  await expect(page.locator('.sidebar-user-role')).toHaveText('Managing Director')
  await page.getByRole('link', { name: 'User Accounts', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Staff accounts' })).toBeVisible()
  const adminRow = page.getByRole('row', { name: /System Administrator/ })
  await expect(adminRow.getByText('Managing Director', { exact: true })).toBeVisible()
  await expect(adminRow.getByText('Protected Managing Director', { exact: true })).toBeVisible()
  await expect(page.locator('#users-filter-role option[value="Admin"]')).toHaveText('Managing Director')

  await page.getByRole('button', { name: 'Add user' }).click()
  await expect(page.locator('#account-role option[value="Admin"]')).toHaveCount(0)
  await expect(page.locator('#account-role option', { hasText: 'Managing Director' })).toHaveCount(0)
})

test('Production Supervisor cannot see account management navigation', async ({ page }) => {
  await login(page, 'prodsupervisor')

  await expect(page.locator('.sidebar-user-role')).toHaveText('Production Supervisor')
  await expect(page.getByRole('link', { name: 'User Accounts', exact: true })).toHaveCount(0)
})
