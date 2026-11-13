"""Test production proxy, settings recovery and order imports with synthetic API responses."""
import argparse
import base64
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:4175')
args = parser.parse_args()
if urlparse(args.base_url).hostname not in ['localhost', '127.0.0.1']:
    raise SystemExit('Use a local production preview only.')
user = {'id': '00000000-0000-4000-8000-000000000001', 'name': 'Import QA', 'email': 'import@example.test', 'role': 'OWNER'}
business = {'id': '00000000-0000-4000-8000-000000000002', 'name': 'Import QA', 'slug': 'import-qa', 'currency': 'INR', 'category_template': 'custom', 'phone': None, 'invoice_trigger': 'Delivered', 'settings': {}}
customer = {'id': '00000000-0000-4000-8000-000000000003', 'name': 'QA Cafe', 'phone': '9123456789', 'active': True}
product = {'id': '00000000-0000-4000-8000-000000000004', 'name': 'Tomato', 'unit': 'kg', 'current_price': 40, 'active': True}
providers = {'primary': {'provider': 'gemini', 'endpoint': 'https://generativelanguage.googleapis.com/v1beta', 'model': 'synthetic-model', 'hasApiKey': True}, 'fallback': {'provider': 'groq', 'endpoint': 'https://api.groq.com/openai/v1', 'model': 'synthetic-fallback', 'hasApiKey': False}}
whatsapp = {'businessId': business['id'], 'phoneNumberId': '', 'wabaId': '', 'graphVersion': 'v23.0', 'defaultCountryCode': '91', 'enabled': False, 'hasAccessToken': False, 'hasAppSecret': False, 'hasVerifyToken': False}
fixtures = {
    '/api/auth/me': {'user': user, 'business': business},
    '/api/dashboard/summary': {'todaySales': 0, 'todayOrdersCount': 0, 'todayCollected': 0, 'totalOutstanding': 0, 'totalCollected': 0, 'statusCounts': {}, 'overdueCustomers': [], 'salesTrend': []},
    '/api/orders': [], '/api/customers': [customer], '/api/products': [product], '/api/payments': [], '/api/invoices': [],
    '/api/whatsapp/revision': {'revision': ''}, '/api/whatsapp/connection': whatsapp,
}
payload = base64.urlsafe_b64encode(json.dumps({'userId': user['id'], 'businessId': business['id']}).encode()).decode().rstrip('=')
token = 'synthetic.' + payload + '.synthetic'
draft = {'items': [{'productId': product['id'], 'quantity': 1.5, 'inputProduct': 'Tomato', 'inputQuantity': 1.5, 'inputUnit': 'kg'}, {'productId': '', 'quantity': None, 'inputProduct': 'Mystery item', 'inputQuantity': 2, 'inputUnit': 'box'}], 'warnings': ['Check item: Mystery item']}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1366, 'height': 650})
    context.add_init_script('localStorage.setItem("orderledger_token", ' + json.dumps(token) + '); localStorage.setItem("orderledger_api_url", "https://orderledger-api.onrender.com");')
    pending = []
    requests = []
    bad_providers = True
    def serve(route):
        nonlocal_path = urlparse(route.request.url).path
        if not nonlocal_path.startswith('/api/') and nonlocal_path != '/health':
            if urlparse(route.request.url).hostname in ['127.0.0.1', 'localhost']: route.continue_()
            else: route.abort()
            return
        requests.append(route.request.url)
        assert route.request.url.startswith(args.base_url), 'Saved Render URL bypassed the website proxy'
        if nonlocal_path == '/api/orders/extract' or route.request.method == 'PATCH' or (nonlocal_path == '/api/customers' and route.request.method == 'POST'):
            pending.append(route)
            return
        if nonlocal_path == '/health': data = {'status': 'ok', 'service': 'OrderLedger Core API', 'apiVersion': 2, 'capabilities': {'idempotentWrites': True}}
        elif nonlocal_path == '/api/auth/templates': data = {'templates': []}
        elif nonlocal_path == '/api/business/connections': data = {'primary': None} if bad_providers else providers
        else: data = fixtures.get(nonlocal_path, {})
        route.fulfill(content_type='application/json', body=json.dumps(data))
    context.route('**/*', serve)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.base_url, wait_until='networkidle', timeout=90000)
    navigation = page.get_by_role('navigation', name='Main navigation')
    navigation.get_by_role('button', name='Settings', exact=True).click()
    page.get_by_role('navigation', name='Settings sections').get_by_role('button', name='Connections', exact=True).click()
    expect(page.get_by_label('Backend API address')).to_have_value('')
    page.get_by_role('button', name='Test connection', exact=True).click()
    expect(page.get_by_text('Connection verified. The server and database are responding.', exact=True)).to_be_visible()
    page.get_by_label('Backend API address').fill('https://orderledger-api.onrender.com/api')
    page.get_by_role('button', name='Save connection', exact=True).click()
    expect(page.get_by_label('Backend API address')).to_have_value('')
    assert page.evaluate('localStorage.getItem("orderledger_token")') == token
    expect(page.get_by_text('The server returned incomplete AI provider settings.', exact=False)).to_be_visible()
    bad_providers = False
    page.get_by_role('alert').get_by_role('button', name='Try again').click()
    expect(page.get_by_label('Primary model', exact=True)).to_have_value('synthetic-model')
    expect(page.locator('.whatsapp-webhook-url')).to_contain_text('https://orderledger-api.onrender.com/webhooks/whatsapp/')
    page.get_by_label('Primary model', exact=True).fill('changed-model')
    page.get_by_role('button', name='Save provider connections').click()
    expect(page.get_by_label('Primary model', exact=True)).to_be_disabled()
    pending.pop(0).fulfill(status=502, content_type='application/json', body=json.dumps({'error': 'Synthetic save failure'}))
    expect(page.get_by_label('Primary model', exact=True)).to_be_enabled()
    expect(page.get_by_label('Primary model', exact=True)).to_have_value('changed-model')
    page.get_by_role('button', name='Discard provider changes').click()
    print('PASS Production proxy preserves login, correct webhook URL, malformed settings recovery and failed-save drafts', flush=True)

    page.get_by_role('banner').get_by_role('button', name='New order', exact=True).click()
    dialog = page.get_by_role('dialog', name='Create an order')
    dialog.get_by_label('Quantity 1', exact=True).fill('3')
    dialog.get_by_label('Order notes', exact=True).fill('Deliver before lunch')
    dialog.get_by_role('button', name='New customer', exact=True).click()
    customer_dialog = page.get_by_role('dialog', name='Add a customer', exact=True)
    customer_dialog.get_by_label('Customer name').fill('New QA Cafe')
    customer_dialog.get_by_label('Phone number').fill('9876543210')
    customer_dialog.get_by_role('button', name='Save customer').click()
    expect(customer_dialog.get_by_label('Customer name')).to_be_disabled()
    pending.pop(0).fulfill(status=409, content_type='application/json', body=json.dumps({'error': 'Phone number already exists'}))
    expect(customer_dialog.get_by_text('Phone number already exists')).to_be_visible()
    expect(customer_dialog.get_by_label('Customer name')).to_have_value('New QA Cafe')
    customer_dialog.get_by_label('Phone number').fill('9876543211')
    customer_dialog.get_by_role('button', name='Save customer').click()
    new_customer = dict(customer, id='00000000-0000-4000-8000-000000000005', name='New QA Cafe', phone='9876543211', credit_terms_days=7)
    fixtures['/api/customers'].append(new_customer)
    pending.pop(0).fulfill(status=201, content_type='application/json', body=json.dumps(new_customer))
    expect(customer_dialog).not_to_be_visible()
    expect(dialog.get_by_label('Customer', exact=True)).to_have_value(new_customer['id'])
    expect(dialog.get_by_label('Quantity 1', exact=True)).to_have_value('3')
    expect(dialog.get_by_label('Order notes', exact=True)).to_have_value('Deliver before lunch')
    print('PASS New customer recovers from duplicate phone errors and is selected without losing the order draft', flush=True)

    dialog.get_by_role('button', name='From text or photo').click()
    dialog.get_by_role('button', name='Extract items').click()
    expect(dialog.get_by_text('Paste an order or upload a photo first.')).to_be_visible()
    dialog.get_by_label('Order text or photo caption').fill('Tomato 500g and another 1kg, mystery item 2 boxes')
    dialog.get_by_role('button', name='Extract items').click()
    expect(dialog.get_by_role('button', name='Create order', exact=True)).to_be_disabled()
    pending.pop(0).fulfill(status=502, content_type='application/json', body=json.dumps({'error': 'Synthetic extraction failure'}))
    expect(dialog.get_by_text('Synthetic extraction failure', exact=False)).to_be_visible()
    expect(dialog.get_by_label('Quantity 1', exact=True)).to_have_value('3')
    dialog.get_by_role('button', name='AI connection', exact=True).click()
    ai_dialog = page.get_by_role('dialog', name='AI connections', exact=True)
    expect(ai_dialog.get_by_label('Primary model')).to_have_value('synthetic-model')
    ai_dialog.get_by_label('Primary model').fill('unsaved-model')
    expect(ai_dialog.get_by_role('button', name='Back to order')).to_be_disabled()
    ai_dialog.get_by_role('button', name='Discard provider changes').click()
    ai_dialog.get_by_role('button', name='Back to order').click()
    expect(dialog.get_by_label('Order text or photo caption')).to_have_value('Tomato 500g and another 1kg, mystery item 2 boxes')
    expect(dialog.get_by_label('Order notes')).to_have_value('Deliver before lunch')
    print('PASS AI settings open inside the order, protect unsaved changes and preserve the order text and notes', flush=True)
    dialog.get_by_role('button', name='Extract items').click()
    pending.pop(0).fulfill(content_type='application/json', body=json.dumps(draft))
    expect(dialog.get_by_label('Quantity 1', exact=True)).to_have_value('1.5')
    expect(dialog.get_by_label('Product 2', exact=True)).to_have_value('')
    expect(dialog.get_by_label('Quantity 2', exact=True)).to_have_value('')
    expect(dialog.get_by_text('Read from the order: Mystery item:', exact=False)).to_be_visible()
    expect(dialog.locator('.total-box')).to_contain_text('₹60.00')
    print('PASS Text import recovers after failure, converts the draft and retains unresolved items for review', flush=True)

    image = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWcUAAAAASUVORK5CYII=')
    dialog.get_by_label('Upload order photo').set_input_files({'name': 'order.png', 'mimeType': 'image/png', 'buffer': image})
    dialog.get_by_role('button', name='Extract items').click()
    route = pending.pop(0)
    assert route.request.post_data_json['image']['data'] == base64.b64encode(image).decode()
    assert route.request.post_data_json['text'].startswith('Tomato')
    route.fulfill(content_type='application/json', body=json.dumps({'items': draft['items'][:1], 'warnings': []}))
    expect(dialog.get_by_label('Product 2', exact=True)).to_have_count(0)
    page.set_viewport_size({'width': 375, 'height': 667})
    assert page.evaluate('document.body.scrollWidth <= innerWidth + 1')
    assert dialog.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
    page.screenshot(path='/tmp/orderledger-ui-qa/order-import-mobile.png', full_page=True)
    assert not errors, errors
    print('PASS Photo bytes and caption reach extraction, mobile dialog fits and no browser exceptions occur', flush=True)
    browser.close()
