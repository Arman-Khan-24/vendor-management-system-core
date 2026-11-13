"""Verify direct payment saving, delayed startup and lost receipts against disposable PostgreSQL.

The published API address is intercepted and forwarded only to a loopback test API.
No production payments or accounts are created.
"""
import argparse
import json
import secrets
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:4175')
parser.add_argument('--api-url', default='http://127.0.0.1:5100')
args = parser.parse_args()
for address in [args.base_url, args.api_url]:
    if urlparse(address).hostname not in ['127.0.0.1', 'localhost']:
        raise SystemExit('Use loopback test servers only.')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1366, 'height': 768})
    context.set_default_timeout(35000)
    expect.set_options(timeout=35000)
    stamp = secrets.token_hex(6)
    registered = context.request.post(args.api_url + '/api/auth/register', data={
        'businessName': 'Payment readiness QA', 'businessSlug': 'payment-ready-' + stamp,
        'ownerName': 'QA Owner', 'email': stamp + '@example.test',
        'password': secrets.token_hex(16), 'categoryTemplate': 'custom',
    })
    assert registered.status == 201
    token = registered.json()['token']
    def api(path, body=None):
        response = context.request.fetch(args.api_url + '/api' + path,
            method='GET' if body is None else 'POST', data=body,
            headers={'Authorization': 'Bearer ' + token})
        assert response.ok, f'{path}: {response.status}'
        return response.json()
    customers = [api('/customers', {'name': name, 'phone': phone}) for name, phone in [
        ('Delayed server cafe', '9000000051'), ('Lost response cafe', '9000000052'), ('Unavailable cafe', '9000000053')]]
    product = api('/products', {'name': 'Produce box', 'unit': 'box', 'currentPrice': 300})
    for customer in customers:
        order = api('/orders', {'customerId': customer['id'], 'items': [{'productId': product['id'], 'quantity': 1}]})
        api('/invoices/order/' + order['id'] + '/generate', {})
    # Simulate an existing login and the server address saved by the previous release.
    context.add_init_script('localStorage.setItem("orderledger_token", ' + json.dumps(token) + '); localStorage.setItem("orderledger_api_url", "https://orderledger-api.onrender.com");')
    mode = 'ready'
    writes = []
    urls = []
    def serve(route):
        nonlocal_path = urlparse(route.request.url).path
        if urlparse(route.request.url).hostname in ['localhost', '127.0.0.1']:
            assert not nonlocal_path.startswith('/api/') and nonlocal_path != '/health', 'Browser used the website proxy'
            route.continue_()
            return
        assert route.request.url.startswith('https://orderledger-api.onrender.com/'), 'Unexpected external request'
        urls.append(route.request.url)
        if nonlocal_path == '/health' and mode == 'unavailable':
            route.fulfill(status=503, json={'status': 'unavailable'})
            return
        if nonlocal_path == '/health' and mode == 'delayed':
            probes_counter[0] += 1
            if probes_counter[0] <= 5:
                route.fulfill(status=429, body='Too Many Requests')
                return
        response = context.request.fetch(args.api_url + nonlocal_path + ('?' + urlparse(route.request.url).query if urlparse(route.request.url).query else ''),
            method=route.request.method, data=route.request.post_data,
            headers=route.request.headers)
        if nonlocal_path == '/api/payments' and route.request.method == 'POST':
            writes.append({'key': route.request.headers.get('idempotency-key'), 'body': route.request.post_data_json})
            if mode == 'lost' and len([w for w in writes if w['body']['customerId'] == customers[1]['id']]) == 1:
                assert response.status == 201
                route.fulfill(status=502, json={'error': 'Synthetic response lost after committing payment'})
                return
        route.fulfill(response=response)
    probes_counter = [0]
    context.route('**/*', serve)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(args.base_url, wait_until='networkidle', timeout=90000)
        assert page.evaluate('localStorage.getItem("orderledger_token")') == token
        page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Payments', exact=True).click()
        def payment(customer):
            page.get_by_role('button', name='Record payment', exact=True).click()
            dialog = page.get_by_role('dialog', name='Record a payment', exact=True)
            dialog.get_by_label('Customer', exact=True).select_option(customer['id'])
            dialog.get_by_label('Amount received').fill('300')
            return dialog
        dialog = payment(customers[0])
        mode = 'delayed'
        dialog.get_by_role('button', name='Save payment', exact=True).click()
        expect(dialog.get_by_label('Amount received')).to_be_disabled()
        expect(dialog.get_by_role('button', name='Close dialog')).to_be_disabled()
        expect(dialog.get_by_label('Amount received')).to_have_value('300')
        expect(dialog).not_to_be_visible(timeout=60000)
        assert probes_counter[0] == 6
        assert len(writes) == 1 and len(api('/payments')) == 1
        assert api('/customers/' + customers[0]['id'])['outstanding_balance'] == 0
        print('PASS Delayed startup recovers after five 429s, keeps the draft, and saves exactly one payment', flush=True)

        mode = 'lost'
        dialog = payment(customers[1])
        dialog.get_by_role('button', name='Save payment', exact=True).click()
        expect(dialog.get_by_role('alert')).to_contain_text('Synthetic response lost')
        expect(dialog.get_by_label('Amount received')).to_have_value('300')
        assert len(api('/payments?customerId=' + customers[1]['id'])) == 1
        dialog.get_by_role('button', name='Save payment', exact=True).click()
        expect(dialog).not_to_be_visible()
        attempts = [w for w in writes if w['body']['customerId'] == customers[1]['id']]
        assert len(attempts) == 2 and attempts[0]['key'] == attempts[1]['key']
        assert len(api('/payments?customerId=' + customers[1]['id'])) == 1
        print('PASS Lost payment receipt retains the retry key and manual retry does not duplicate the real DB payment', flush=True)

        mode = 'unavailable'
        dialog = payment(customers[2])
        before = len(writes)
        dialog.get_by_role('button', name='Save payment', exact=True).click()
        expect(dialog.get_by_role('alert')).to_contain_text('Your submission has not been sent', timeout=75000)
        expect(dialog.get_by_label('Amount received')).to_have_value('300')
        expect(dialog.get_by_role('button', name='Save payment', exact=True)).to_be_enabled()
        assert len(writes) == before
        assert api('/payments?customerId=' + customers[2]['id']) == []
        mode = 'ready'
        dialog.get_by_role('button', name='Save payment', exact=True).click()
        expect(dialog).not_to_be_visible()
        assert len(api('/payments?customerId=' + customers[2]['id'])) == 1
        assert all(url.startswith('https://orderledger-api.onrender.com/') for url in urls)
        assert page.evaluate('localStorage.getItem("orderledger_token")') == token
        assert not errors, errors
        print('PASS Unavailable database sends no payment, preserves draft/login, and recovers when ready', flush=True)
    except Exception:
        page.screenshot(path='/tmp/orderledger-payment-readiness-failure.png', full_page=True)
        raise
    finally:
        browser.close()
