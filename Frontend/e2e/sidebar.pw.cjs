const { test, expect } = require('@playwright/test')

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
  await expect(page.locator('.dashboard-sidebar')).toBeVisible({ timeout: 15000 })
}

async function readSidebarMetrics(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.sidebar-nav')
    const footer = document.querySelector('.sidebar-footer')
    const groups = [...document.querySelectorAll('.sidebar-nav-group')]
    const links = [...document.querySelectorAll('.sidebar-link')]
    const lastLink = links[links.length - 1]
    const navRect = nav.getBoundingClientRect()
    const footerRect = footer.getBoundingClientRect()
    const lastLinkRect = lastLink.getBoundingClientRect()
    const iconRect = links[0].querySelector('.sidebar-link-icon').getBoundingClientRect()
    const labelStyle = getComputedStyle(links[0].querySelector('.sidebar-link-label'))
    const navStyle = getComputedStyle(nav)

    return {
      overflowY: navStyle.overflowY,
      clientHeight: nav.clientHeight,
      scrollHeight: nav.scrollHeight,
      lastLinkBottom: lastLinkRect.bottom,
      navBottom: navRect.bottom,
      footerTop: footerRect.top,
      remainingSpaceBelowLastLink: navRect.bottom - lastLinkRect.bottom,
      iconWidth: iconRect.width,
      labelFontSize: Number.parseFloat(labelStyle.fontSize),
      groupDividers: groups.slice(1).map((group) => {
        const style = getComputedStyle(group)
        return `${style.borderTopWidth} ${style.borderTopStyle}`
      }),
    }
  })
}

test.beforeEach(async ({ page }) => {
  await stubApi(page)
})

test('expanded desktop and mobile sidebars fill space cleanly without scrolling or clipping', async ({ page }) => {
  await login(page, 'admin')

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1280, height: 600 },
  ]) {
    await page.setViewportSize(viewport)
    const metrics = await readSidebarMetrics(page)

    expect(metrics.overflowY).toBe('hidden')
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight)
    expect(metrics.lastLinkBottom).toBeLessThanOrEqual(metrics.navBottom + 1)
    expect(metrics.lastLinkBottom).toBeLessThanOrEqual(metrics.footerTop + 1)
    expect(metrics.remainingSpaceBelowLastLink).toBeLessThan(80)
    expect(metrics.groupDividers).toEqual(['0px none', '0px none'])

    if (viewport.height >= 720) {
      expect(metrics.iconWidth).toBeGreaterThanOrEqual(20)
      expect(metrics.labelFontSize).toBeGreaterThanOrEqual(14)
    }
  }

  for (const mobileViewport of [
    { width: 390, height: 844 },
    { width: 375, height: 667 },
  ]) {
    await page.setViewportSize(mobileViewport)
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(page.locator('.dashboard-sidebar')).toHaveClass(/is-open/)

    const metrics = await readSidebarMetrics(page)
    expect(metrics.overflowY).toBe('hidden')
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight)
    expect(metrics.lastLinkBottom).toBeLessThanOrEqual(metrics.navBottom + 1)
    expect(metrics.groupDividers).toEqual(['0px none', '0px none'])

    await page.getByRole('button', { name: 'Close navigation', exact: true }).click()
  }
})

test('collapsed sidebar separates Monitor, Analytics, and Admin with dividers without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, 'admin')

  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(page.locator('.dashboard-sidebar')).toHaveClass(/is-collapsed/)
  await expect(page.locator('.sidebar-nav-heading').first()).toBeHidden()

  const metrics = await readSidebarMetrics(page)
  expect(metrics.overflowY).toBe('hidden')
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight)
  expect(metrics.lastLinkBottom).toBeLessThanOrEqual(metrics.navBottom + 1)
  expect(metrics.groupDividers).toEqual(['1px solid', '1px solid'])

  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  const expandedMetrics = await readSidebarMetrics(page)
  expect(expandedMetrics.groupDividers).toEqual(['0px none', '0px none'])
})

test('sidebar opening and closing use lightweight motion and respect reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, 'admin')

  const desktopDurations = await page.evaluate(() => {
    const sidebar = document.querySelector('.dashboard-sidebar')
    const nav = document.querySelector('.sidebar-nav')
    const expandDuration = Number.parseFloat(getComputedStyle(sidebar).transitionDuration) * 1000
    const navTransition = getComputedStyle(nav).transitionProperty
    return { expandDuration, navTransition }
  })
  expect(desktopDurations.expandDuration).toBeGreaterThan(0)
  expect(desktopDurations.expandDuration).toBeLessThanOrEqual(200)
  expect(desktopDurations.navTransition).toBe('none')

  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(page.locator('.dashboard-sidebar')).toHaveClass(/is-collapsed/)
  await expect.poll(async () => page.evaluate(() => ({
    sidebarWidth: Math.round(document.querySelector('.dashboard-sidebar').getBoundingClientRect().width),
    navWidth: Math.round(document.querySelector('.sidebar-nav').getBoundingClientRect().width),
  }))).toEqual({ sidebarWidth: 64, navWidth: 63 })

  const collapseDuration = await page.evaluate(
    () => Number.parseFloat(getComputedStyle(document.querySelector('.dashboard-sidebar')).transitionDuration) * 1000,
  )
  expect(collapseDuration).toBeGreaterThan(0)
  expect(collapseDuration).toBeLessThan(desktopDurations.expandDuration)

  await page.setViewportSize({ width: 390, height: 844 })
  const closedDrawer = await page.evaluate(() => {
    const sidebar = document.querySelector('.dashboard-sidebar')
    const backdrop = document.querySelector('.sidebar-backdrop')
    return {
      sidebarDuration: Number.parseFloat(getComputedStyle(sidebar).transitionDuration) * 1000,
      backdropOpacity: Number.parseFloat(getComputedStyle(backdrop).opacity),
      backdropVisibility: getComputedStyle(backdrop).visibility,
    }
  })
  expect(closedDrawer.sidebarDuration).toBeGreaterThan(0)
  expect(closedDrawer.sidebarDuration).toBeLessThanOrEqual(160)
  expect(closedDrawer.backdropOpacity).toBe(0)
  expect(closedDrawer.backdropVisibility).toBe('hidden')

  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.locator('.dashboard-sidebar')).toHaveClass(/is-open/)
  await expect(page.locator('.sidebar-backdrop')).toHaveClass(/is-open/)
  const openDrawer = await page.evaluate(() => {
    const sidebar = document.querySelector('.dashboard-sidebar')
    return Number.parseFloat(getComputedStyle(sidebar).transitionDuration) * 1000
  })
  expect(openDrawer).toBeGreaterThan(closedDrawer.sidebarDuration)
  expect(openDrawer).toBeLessThanOrEqual(220)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reducedDuration = await page.evaluate(() => {
    const sidebar = document.querySelector('.dashboard-sidebar')
    return Number.parseFloat(getComputedStyle(sidebar).transitionDuration) * 1000
  })
  expect(reducedDuration).toBeLessThanOrEqual(1)
})
