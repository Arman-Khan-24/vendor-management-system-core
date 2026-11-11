"""Check viewport layout, sidebar interactions, and page recovery on disposable localhost data.

Start the isolated API and a frontend using VITE_API_URL=http://127.0.0.1:5100,
then run this script after ui_acceptance.py with the same --base-url.
"""
import argparse
import json
import tempfile
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:5175')
args = parser.parse_args()
if urlparse(args.base_url).hostname not in ['localhost', '127.0.0.1']:
    raise SystemExit('Use a disposable localhost workspace only.')
out = Path(tempfile.gettempdir()) / 'orderledger-ui-qa'
checks = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(storage_state=str(out / 'browser-state.json'), viewport={'width': 1366, 'height': 650})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.base_url)
    page.wait_for_load_state('networkidle')
    navigation = page.get_by_role('navigation', name='Main navigation', exact=True)
    expect(navigation).to_be_visible()

    def nav(label):
        navigation.get_by_role('button', name=label, exact=True).click()
        expect(page.locator('.page-recovery')).to_have_count(0)

    def layout():
        dimensions = page.evaluate('''() => ({
            width: innerWidth, height: innerHeight,
            pageWidth: document.documentElement.scrollWidth,
            pageHeight: document.documentElement.scrollHeight,
            sidebar: document.querySelector('.sidebar').getBoundingClientRect().width,
            main: document.querySelector('main').getBoundingClientRect().toJSON(),
            footer: document.querySelector('.bottom-nav').getBoundingClientRect().toJSON()
        })''')
        assert dimensions['pageWidth'] <= dimensions['width'] + 1, dimensions
        assert dimensions['pageHeight'] <= dimensions['height'] + 1, dimensions
        assert dimensions['main']['bottom'] <= dimensions['height'] + 1, dimensions
        if dimensions['width'] > 740:
            assert dimensions['sidebar'] <= dimensions['width'] * .25 + 1, dimensions
        else:
            assert dimensions['main']['bottom'] <= dimensions['footer']['top'] + 1, dimensions

    for label in ['Orders', 'Catalog', 'Customers', 'Invoices', 'Payments', 'Reports', 'WhatsApp inbox', 'Settings', 'Overview']:
        nav(label)
    checks.append('Every page opens without an uncaught exception')
    page.get_by_role('button', name='Workspace help', exact=True).click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.keyboard.press('Escape')
    page.get_by_role('banner').get_by_role('button', name='New order', exact=True).click()
    expect(page.get_by_role('dialog', name='Create an order')).to_be_visible()
    page.keyboard.press('Escape')
    checks.append('Shared header buttons and dialogs work')

    separator = page.get_by_role('separator', name='Resize sidebar')
    page.get_by_role('button', name='Maximize sidebar', exact=True).click()
    expect(separator).to_have_attribute('aria-valuenow', '341')
    layout()
    page.get_by_role('button', name='Minimize sidebar', exact=True).click()
    expect(page.get_by_role('button', name='Expand sidebar', exact=True)).to_be_visible()
    expect(separator).to_have_attribute('aria-valuenow', '72')
    nav('Customers')
    page.get_by_role('button', name='Expand sidebar', exact=True).click()
    separator.focus()
    page.keyboard.press('Home')
    expect(separator).to_have_attribute('aria-valuenow', '160')
    page.keyboard.press('ArrowRight')
    expect(separator).to_have_attribute('aria-valuenow', '176')
    page.keyboard.press('End')
    expect(separator).to_have_attribute('aria-valuenow', '341')
    checks.append('Minimize, expand, maximize, and keyboard resize work')

    bounds = separator.bounding_box()
    start_x = bounds['x'] + bounds['width'] / 2
    y = bounds['y'] + bounds['height'] / 2
    page.mouse.move(start_x, y)
    page.mouse.down()
    page.mouse.move(start_x - 120, y, steps=8)
    page.mouse.up()
    expect(separator).to_have_attribute('aria-valuenow', '221')
    bounds = separator.bounding_box()
    page.mouse.move(bounds['x'] + bounds['width'] / 2, y)
    page.mouse.down()
    page.mouse.move(1300, y, steps=8)
    page.mouse.up()
    expect(separator).to_have_attribute('aria-valuenow', '341')
    layout()
    page.reload()
    expect(page.get_by_role('separator', name='Resize sidebar')).to_have_attribute('aria-valuenow', '341')
    checks.append('Pointer drag respects the cap and width persists after reload')

    for width, height in [(1920, 1080), (1366, 650), (1024, 600), (800, 600), (741, 420), (740, 390), (390, 844), (375, 667), (320, 568)]:
        page.set_viewport_size({'width': width, 'height': height})
        page.wait_for_timeout(100)
        layout()
        if width > 740:
            nav('Overview')
            page.locator('#main-content').evaluate('(element) => element.scrollTop = element.scrollHeight')
            nav('Orders')
            assert page.locator('#main-content').evaluate('(element) => element.scrollTop') == 0
        else:
            mobile = page.get_by_role('navigation', name='Mobile navigation', exact=True)
            mobile.get_by_role('button', name='More', exact=True).click()
            dialog = page.get_by_role('dialog', name='Your workspace', exact=True)
            expect(dialog.get_by_role('button', name='Settings', exact=True)).to_be_visible()
            dialog.get_by_role('button', name='Settings', exact=True).click()
            page.get_by_role('navigation', name='Settings sections').get_by_role('button', name='Business profile', exact=True).click()
            layout()
        page.screenshot(path=str(out / f'shell-{width}x{height}.png'))
    checks.append('Nine desktop, tablet, phone, and landscape sizes fit viewport; navigation resets content scroll')
    page.emulate_media(reduced_motion='reduce')
    layout()
    checks.append('Reduced motion keeps the layout usable')
    assert not errors, errors

    page.set_viewport_size({'width': 1366, 'height': 650})
    def broken_summary(route):
        response = route.fetch()
        data = response.json()
        data['statusCounts'] = None
        route.fulfill(response=response, json=data)
    page.route('**/api/dashboard/summary', broken_summary)
    page.reload()
    expect(page.get_by_text('This page couldn’t load.', exact=True)).to_be_visible()
    expect(navigation).to_be_visible()
    nav('Orders')
    page.unroute('**/api/dashboard/summary', broken_summary)
    page.reload()
    expect(navigation).to_be_visible()
    expect(page.locator('.page-recovery')).to_have_count(0)
    checks.append('A page render fault leaves navigation usable and reload restores the page')
    (out / 'results-shell.json').write_text(json.dumps({'checks': checks, 'errors_before_injected_fault': [], 'artifacts': str(out)}, indent=2))
    for check in checks:
        print('PASS', check)
    context.close()
    browser.close()
