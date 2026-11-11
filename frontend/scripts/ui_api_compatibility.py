"""Reproduce the legacy API contract against a disposable browser session.

Start Vite, then run this script with --base-url. No real account or API writes.
"""
import argparse
import json
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:5175')
args = parser.parse_args()
if urlparse(args.base_url).hostname not in ['localhost', '127.0.0.1']:
    raise SystemExit('Use a local frontend only.')

user = {'id': '00000000-0000-4000-8000-000000000001', 'name': 'Compatibility QA', 'email': 'qa@example.test', 'role': 'OWNER'}
business = {'id': '00000000-0000-4000-8000-000000000002', 'name': 'Compatibility QA', 'slug': 'compatibility-qa', 'currency': 'INR', 'category_template': 'custom', 'phone': None, 'invoice_trigger': 'Delivered'}
summary = {'todaySales': 0, 'todayOrdersCount': 0, 'todayCollected': 0, 'totalOutstanding': 0, 'totalCollected': 0, 'statusCounts': {'Received': 0, 'Packed': 0, 'Delivered': 0}, 'overdueCustomers': [], 'salesTrend': []}
# Exact response returned by the live, outdated Render backend on 2026-11-12.
messages = {'provider': 'mock', 'messages': []}
customer = {'id': '00000000-0000-4000-8000-000000000003', 'name': 'QA Café', 'phone': '9123456789', 'active': True}
product = {'id': '00000000-0000-4000-8000-000000000004', 'name': 'QA tomatoes', 'unit': 'kg', 'current_price': 45.25, 'active': True}
fixtures = {
    '/api/auth/me': {'user': user, 'business': business},
    '/api/dashboard/summary': summary,
    '/api/orders': [], '/api/customers': [customer], '/api/products': [product], '/api/payments': [], '/api/invoices': [],
    '/api/whatsapp/revision': {'revision': ''},
    '/api/reports/dues': {'customers': [], 'invoices': [], 'agingBuckets': {}, 'totalOutstanding': 0, 'totalOverdue': 0},
}
held_routes = []
hold_catalog = True

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1366, 'height': 650})
    context.add_init_script("localStorage.setItem('orderledger_token', 'synthetic-session'); localStorage.setItem('orderledger_api_url', 'http://127.0.0.1:5100');")
    def serve(route):
        path = urlparse(route.request.url).path
        if not path.startswith('/api/'):
            route.continue_()
            return
        if hold_catalog and path in ['/api/customers', '/api/products']:
            held_routes.append(route)
            return
        if path == '/api/whatsapp/messages':
            data, status = messages, 200
        else:
            data, status = fixtures.get(path, {'error': 'API route not found.'}), 200 if path in fixtures else 404
        route.fulfill(status=status, content_type='application/json', body=json.dumps(data))
    context.route('**/api/**', serve)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.base_url, wait_until='domcontentloaded')
    page.get_by_role('banner').get_by_role('button', name='New order', exact=True).click()
    dialog = page.get_by_role('dialog', name='Create an order', exact=True)
    expect(dialog.get_by_text('Loading customers and products…', exact=True)).to_be_visible()
    page.wait_for_function('true')
    assert len(held_routes) == 2, 'Expected both initial catalog requests to be pending'
    hold_catalog = False
    for route in held_routes:
        route.fulfill(status=200, content_type='application/json', body=json.dumps(fixtures[urlparse(route.request.url).path]))
    expect(dialog.get_by_label('Customer', exact=True)).to_have_value(customer['id'])
    expect(dialog.get_by_label('Product 1', exact=True)).to_have_value(product['id'])
    dialog.get_by_label('Quantity 1', exact=True).fill('2')
    expect(dialog.locator('.total-box').get_by_text('₹90.50', exact=True)).to_be_visible()
    dialog.get_by_role('button', name='Cancel', exact=True).click()
    print('PASS Order opened before catalog loads selects real IDs and calculates the correct total')
    page.wait_for_load_state('networkidle')
    navigation = page.get_by_role('navigation', name='Main navigation', exact=True)
    navigation.get_by_role('button', name='WhatsApp inbox', exact=True).click()
    expect(page.get_by_role('heading', name='WhatsApp inbox', exact=True)).to_be_visible()
    expect(page.get_by_role('alert').get_by_text('WhatsApp inbox is unavailable because this server is running an older OrderLedger backend.', exact=False)).to_be_visible()
    expect(page.locator('.page-recovery')).to_have_count(0)
    print('PASS Legacy mock object shows a connection error without crashing')

    messages = []
    page.get_by_role('alert').get_by_role('button', name='Try again', exact=True).click()
    expect(page.get_by_role('alert')).to_have_count(0)
    expect(page.get_by_role('heading', name='Your WhatsApp inbox is ready')).to_be_visible()
    print('PASS Retry recovers after the API returns a current message array')

    for name in ['Orders', 'Catalog', 'Customers', 'Invoices', 'Payments', 'Reports', 'Settings', 'Overview']:
        navigation.get_by_role('button', name=name, exact=True).click()
        expect(page.locator('.page-recovery')).to_have_count(0)
    navigation.get_by_role('button', name='Settings', exact=True).click()
    expect(page.get_by_text('Your website is connected to an older OrderLedger backend.', exact=False)).to_be_visible()
    expect(page.get_by_role('button', name='Save changes', exact=True)).to_be_disabled()
    page.get_by_role('navigation', name='Settings sections').get_by_role('button', name='Connections', exact=True).click()
    context.route('**/health', lambda route: route.abort('failed'))
    page.get_by_role('button', name='Test connection', exact=True).click()
    expect(page.get_by_role('alert').get_by_text('Cannot reach this server.', exact=False)).to_be_visible()
    expect(page.get_by_text('Failed to fetch', exact=True)).to_have_count(0)
    context.unroute('**/health')
    context.route('**/health', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps({'status': 'ok', 'service': 'OrderLedger Core API'})))
    page.get_by_role('button', name='Test connection', exact=True).click()
    expect(page.get_by_role('alert').get_by_text('This server is running an older or incompatible OrderLedger API.', exact=False)).to_be_visible()
    print('PASS Connection test distinguishes network failures from outdated API responses')
    assert not errors, errors
    print('PASS Legacy business response keeps navigation usable and prevents unsupported settings writes')
    context.close()
    browser.close()
