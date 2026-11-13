"""Payment limits against a disposable loopback API; never use customer data."""
import argparse
import json
import secrets
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:5176')
parser.add_argument('--api-url', default='http://127.0.0.1:5100')
args = parser.parse_args()
for address in [args.base_url, args.api_url]:
    if urlparse(address).hostname not in ['localhost', '127.0.0.1']:
        raise SystemExit('Use disposable loopback servers only.')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1366, 'height': 768})
    context.set_default_timeout(25000)
    expect.set_options(timeout=25000)
    stamp = secrets.token_hex(6)
    registered = context.request.post(args.api_url + '/api/auth/register', data={
        'businessName': 'Payment cap QA', 'businessSlug': 'payment-cap-' + stamp,
        'ownerName': 'QA Owner', 'email': stamp + '@example.test',
        'password': secrets.token_hex(16), 'categoryTemplate': 'custom',
    })
    assert registered.status == 201
    token = registered.json()['token']
    def api(path, data=None):
        response = context.request.fetch(args.api_url + '/api' + path,
            method='GET' if data is None else 'POST', data=data,
            headers={'Authorization': 'Bearer ' + token})
        assert response.ok, f'{path}: {response.status}'
        return response.json()
    single = api('/customers', {'name': 'Single bill cafe', 'phone': '9000000001'})
    multiple = api('/customers', {'name': 'Multiple bills cafe', 'phone': '9000000002'})
    empty = api('/customers', {'name': 'No bills cafe', 'phone': '9000000003'})
    product = api('/products', {'name': 'Produce box', 'unit': 'box', 'currentPrice': 400})
    for customer, quantity in [(single, 1), (multiple, 0.5), (multiple, 0.5), (multiple, 0.5)]:
        order = api('/orders', {'customerId': customer['id'], 'items': [{'productId': product['id'], 'quantity': quantity}]})
        api('/invoices/order/' + order['id'] + '/generate', {})
    context.add_init_script('localStorage.setItem("orderledger_token", ' + json.dumps(token) + '); localStorage.setItem("orderledger_api_url", ' + json.dumps(args.api_url) + ');')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.base_url, wait_until='networkidle')
    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Payments', exact=True).click()
    def open_payment():
        page.get_by_role('button', name='Record payment', exact=True).click()
        return page.get_by_role('dialog', name='Record a payment', exact=True)
    dialog = open_payment()
    dialog.get_by_label('Customer', exact=True).select_option(single['id'])
    expect(dialog.get_by_label('Amount received')).to_have_attribute('max', '400')
    before = len(api('/payments'))
    dialog.get_by_label('Amount received').fill('450')
    expect(dialog.get_by_role('alert')).to_contain_text('₹400.00')
    expect(dialog.get_by_role('button', name='Save payment', exact=True)).to_be_disabled()
    assert len(api('/payments')) == before
    dialog.screenshot(path='/tmp/orderledger-payment-cap.png')
    print('PASS A 400 bill rejects 450 in the form without recording a payment', flush=True)
    dialog.get_by_label('Amount received').fill('400')
    dialog.get_by_role('button', name='Save payment', exact=True).click()
    expect(dialog).not_to_be_visible()
    assert api('/customers/' + single['id'])['outstanding_balance'] == 0
    print('PASS Paying exactly 400 settles the bill without credit', flush=True)
    dialog = open_payment()
    dialog.get_by_label('Customer', exact=True).select_option(empty['id'])
    expect(dialog.get_by_label('Amount received')).to_be_disabled()
    expect(dialog.get_by_role('button', name='Save payment', exact=True)).to_be_disabled()
    expect(dialog.get_by_text('This customer has no unpaid invoices. Create an invoice before recording a payment.')).to_be_visible()
    print('PASS Customers without unpaid invoices cannot make advance payments', flush=True)
    dialog.get_by_label('Customer', exact=True).select_option(multiple['id'])
    expect(dialog.get_by_label('Amount received')).to_have_attribute('max', '600')
    dialog.get_by_label('Amount received').fill('601')
    expect(dialog.get_by_role('button', name='Save payment', exact=True)).to_be_disabled()
    dialog.get_by_label('Amount received').fill('600')
    dialog.get_by_role('button', name='Save payment', exact=True).click()
    expect(dialog).not_to_be_visible()
    payment = api('/payments?customerId=' + multiple['id'])[0]
    assert payment['unallocated_amount'] == 0 and len(payment['allocations']) == 3
    assert api('/customers/' + multiple['id'])['outstanding_balance'] == 0
    assert not errors, errors
    print('PASS Three pending bills can be settled together up to their 600 balance', flush=True)
    browser.close()
