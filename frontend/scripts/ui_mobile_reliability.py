"""Mobile layout and real lost-response retries; disposable loopback servers only."""
import argparse
import json
import secrets
import tempfile
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:5175')
parser.add_argument('--api-url', default='http://127.0.0.1:5100')
args = parser.parse_args()
for address in [args.base_url, args.api_url]:
    if urlparse(address).hostname not in ['localhost', '127.0.0.1']:
        raise SystemExit('Use disposable loopback servers only.')
out = Path(tempfile.gettempdir()) / 'orderledger-mobile-qa'
out.mkdir(exist_ok=True)
checks = []


def passed(name):
    checks.append(name)
    print('PASS ' + name, flush=True)


def fits(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Horizontal page overflow'


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 390, 'height': 844}, reduced_motion='reduce')
    context.set_default_timeout(25000)
    expect.set_options(timeout=25000)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    sizes = [(320, 568), (375, 667), (390, 844), (430, 932), (844, 390), (768, 1024), (1440, 1000)]

    try:
        page.goto(args.base_url, wait_until='networkidle')
        for width, height in sizes:
            page.set_viewport_size({'width': width, 'height': height})
            expect(page.get_by_role('heading', name='Welcome back.')).to_be_visible()
            fits(page)
            if width in [390, 1440]:
                page.screenshot(path=str(out / f'auth-{width}.png'), full_page=True)
        page.set_viewport_size({'width': 320, 'height': 568})
        page.get_by_role('button', name='Create a business', exact=True).click()
        page.get_by_label('Business name', exact=True).fill('Mobile test')
        page.get_by_label('Password', exact=True).fill('test-password')
        page.get_by_role('button', name='Create business', exact=True).scroll_into_view_if_needed()
        fits(page)
        passed('Sign-in and long registration fit phone, landscape, tablet and desktop widths')

        stamp = secrets.token_hex(6)
        response = context.request.post(args.api_url + '/api/auth/register', data={
            'businessName': 'Everyday Market', 'businessSlug': 'mobile-' + stamp,
            'ownerName': 'Test Owner', 'email': stamp + '@example.test',
            'password': secrets.token_hex(16), 'categoryTemplate': 'custom'
        })
        assert response.status == 201
        token = response.json()['token']

        def api(path, body=None, method=None):
            response = context.request.fetch(args.api_url + '/api' + path, method=method or ('GET' if body is None else 'POST'), data=body, headers={'Authorization': 'Bearer ' + token})
            assert response.ok, f'{path}: {response.status}'
            return response.json()

        customer = api('/customers', {'name': 'Maple Café', 'phone': '9876543210'})
        product = api('/products', {'name': 'Fresh tomatoes', 'unit': 'kg', 'currentPrice': 45.25})
        order = api('/orders', {'customerId': customer['id'], 'items': [{'productId': product['id'], 'quantity': 2}]})
        api('/invoices/order/' + order['id'] + '/generate', {})
        page.evaluate('([token, api]) => { localStorage.setItem("orderledger_token", token); localStorage.setItem("orderledger_api_url", api); }', [token, args.api_url])
        page.reload(wait_until='networkidle')

        def nav(label):
            if page.viewport_size['width'] <= 740:
                mobile = page.get_by_role('navigation', name='Mobile navigation', exact=True)
                target = mobile.get_by_role('button', name='Home' if label == 'Overview' else label, exact=True)
                if target.count():
                    target.click()
                else:
                    mobile.get_by_role('button', name='More', exact=True).click()
                    page.get_by_role('dialog', name='Your workspace').get_by_role('button', name=label, exact=True).click()
            else:
                page.get_by_role('navigation', name='Main navigation', exact=True).get_by_role('button', name=label, exact=True).click()

        def capture(name):
            dismiss = page.get_by_role('button', name='Dismiss notification')
            if dismiss.count():
                dismiss.click()
            page.evaluate('window.scrollTo(0, 0)')
            page.screenshot(path=str(out / name), animations='disabled')

        for width, height in sizes:
            page.set_viewport_size({'width': width, 'height': height})
            for label in ['Overview', 'Orders', 'Catalog', 'Customers', 'Invoices', 'Payments', 'Reports', 'Settings']:
                nav(label)
                fits(page)
            nav('Overview')
            if width == 390:
                expect(page.locator('.activity-cards')).to_be_visible()
                expect(page.locator('.dashboard-table')).not_to_be_visible()
                capture('dashboard-390.png')
            if width <= 430:
                nav_buttons = page.locator('.bottom-nav button').evaluate_all('(buttons) => buttons.map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; })')
                assert all(w >= 44 and h >= 44 for w, h in nav_buttons)
        passed('Eight workspace pages fit all seven viewports; mobile activity cards and navigation targets verified')

        page.set_viewport_size({'width': 390, 'height': 844})
        nav('Settings')
        page.get_by_role('navigation', name='Settings sections').get_by_role('button', name='Appearance', exact=True).click()
        page.get_by_label('Default theme', exact=True).select_option('dark')
        page.get_by_role('button', name='Save changes', exact=True).click()
        expect(page.get_by_text('All changes saved.', exact=True)).to_be_visible()
        expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
        fits(page)
        capture('settings-dark-390.png')
        nav('Overview')
        capture('dashboard-dark-390.png')
        api('/business', {'settings': {'branding': {'theme': 'light'}}}, 'PATCH')
        page.reload(wait_until='networkidle')
        passed('Mobile appearance saves to the API; dark dashboard and settings render without overflow')

        def open_order():
            page.get_by_role('banner').get_by_role('button', name='New order', exact=True).click()
            return page.get_by_role('dialog', name='Create an order')

        dialog = open_order()
        page.set_viewport_size({'width': 320, 'height': 360})
        dialog.get_by_label('Order notes', exact=True).fill('Keyboard layout')
        dialog.get_by_role('button', name='Create order', exact=True).scroll_into_view_if_needed()
        fits(page)
        rect = dialog.get_by_role('button', name='Create order', exact=True).bounding_box()
        assert rect and rect['y'] >= 0 and rect['y'] + rect['height'] <= 360
        remove = dialog.get_by_role('button', name='Remove item 1', exact=True).bounding_box()
        assert remove and remove['width'] >= 44 and remove['height'] >= 44
        dialog.get_by_role('button', name='Cancel', exact=True).click()
        page.set_viewport_size({'width': 390, 'height': 844})
        passed('Order form fits a short keyboard-sized viewport with reachable actions and 44px remove target')

        def lose_response(endpoint, keys):
            def intercept(route):
                if route.request.method != 'POST':
                    route.continue_()
                    return
                keys.append(route.request.headers.get('idempotency-key'))
                result = route.fetch()  # Commit on the actual disposable backend.
                assert result.status == 201
                if len(keys) == 1:
                    route.abort('connectionreset')
                else:
                    route.fulfill(response=result)
            page.route('**/api/' + endpoint, intercept)
            return intercept

        before = len(api('/orders'))
        keys = []
        handler = lose_response('orders', keys)
        dialog = open_order()
        dialog.get_by_label('Order notes', exact=True).fill('Lost response retry')
        dialog.get_by_role('button', name='Create order', exact=True).click()
        expect(dialog.get_by_role('alert')).to_contain_text('unconfirmed')
        expect(dialog.get_by_label('Order notes', exact=True)).to_have_value('Lost response retry')
        expect(dialog.get_by_role('alert')).to_be_focused()
        assert len(api('/orders')) == before + 1
        # Reload loses React state, but the uncertain submission's retry identity survives.
        page.reload(wait_until='networkidle')
        dialog = open_order()
        dialog.get_by_label('Order notes', exact=True).fill('Lost response retry')
        dialog.get_by_role('button', name='Create order', exact=True).click()
        expect(dialog).not_to_be_visible()
        assert keys[0] and keys[0] == keys[1]
        assert len(api('/orders')) == before + 1
        # Confirmed success clears the key for a deliberate new order.
        dialog = open_order()
        dialog.get_by_label('Order notes', exact=True).fill('Lost response retry')
        dialog.get_by_role('button', name='Create order', exact=True).click()
        expect(dialog).not_to_be_visible()
        assert keys[2] != keys[1] and len(api('/orders')) == before + 2
        page.unroute('**/api/orders', handler)
        passed('Lost order response survives reload/retry without duplication; a later deliberate order gets a fresh key')

        nav('Payments')
        before = len(api('/payments'))
        keys = []
        handler = lose_response('payments', keys)
        page.get_by_role('button', name='Record payment', exact=True).click()
        dialog = page.get_by_role('dialog', name='Record a payment')
        dialog.get_by_label('Amount received', exact=True).fill('20')
        dialog.get_by_role('button', name='Save payment', exact=True).click()
        expect(dialog.get_by_role('alert')).to_contain_text('unconfirmed')
        expect(dialog.get_by_label('Amount received', exact=True)).to_have_value('20')
        dialog.get_by_role('button', name='Save payment', exact=True).click()
        expect(dialog).not_to_be_visible()
        assert keys[0] and keys[0] == keys[1]
        assert len(api('/payments')) == before + 1
        page.unroute('**/api/payments', handler)
        passed('Lost payment response can be retried from the retained form with only one recorded payment')

        reference = 'f21877bd-5701-4b4a-90f8-3f99bfc49bc1'
        def server_error(route):
            if route.request.method == 'POST':
                route.fulfill(status=500, content_type='application/json', headers={'X-Request-ID': reference, 'Access-Control-Expose-Headers': 'X-Request-ID'}, body=json.dumps({'error': 'Something went wrong on the server. Please try again.'}))
            else:
                route.continue_()
        page.route('**/api/orders', server_error)
        dialog = open_order()
        dialog.get_by_role('button', name='Create order', exact=True).click()
        expect(dialog.get_by_role('alert')).to_contain_text(reference)
        dialog.get_by_role('button', name='Cancel', exact=True).click()
        page.unroute('**/api/orders', server_error)
        passed('Unexpected API failures show the support reference and keep the form open')

        page.route('**/health', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps({'status': 'ok', 'service': 'OrderLedger Core API', 'apiVersion': 2})))
        before = len(api('/orders'))
        dialog = open_order()
        dialog.get_by_role('button', name='Create order', exact=True).click()
        expect(dialog.get_by_role('alert')).to_contain_text('server needs an update')
        assert len(api('/orders')) == before
        dialog.get_by_role('button', name='Cancel', exact=True).click()
        page.unroute('**/health')
        passed('A backend without retry support cannot silently accept an unsafe financial save')

        page.route('**/health', lambda route: route.fulfill(status=503, json={'status': 'unavailable'}))
        dialog = open_order()
        dialog.get_by_role('button', name='Create order', exact=True).click()
        expect(dialog.get_by_role('alert')).to_contain_text('server or database is not ready')
        assert len(api('/orders')) == before
        dialog.get_by_role('button', name='Cancel', exact=True).click()
        page.unroute('**/health')
        passed('Temporary server downtime gives a retry message without sending the financial write')

        assert not errors, errors
        def broken_screen(route):
            result = route.fetch()
            body = result.json()
            body['business']['name'] = {'invalid': 'render input'}
            route.fulfill(response=result, json=body)
        page.route('**/api/auth/me', broken_screen)
        page.reload(wait_until='networkidle')
        expect(page.get_by_role('heading', name='Let’s get you back.')).to_be_visible()
        fits(page)
        page.screenshot(path=str(out / 'recovery-390.png'), full_page=True)
        page.unroute('**/api/auth/me', broken_screen)
        page.get_by_role('button', name='Reload workspace', exact=True).click()
        expect(page.get_by_role('navigation', name='Mobile navigation', exact=True)).to_be_visible()
        passed('A render crash shows the recovery screen and reload returns to the authenticated workspace')
        (out / 'results.json').write_text(json.dumps({'checks': checks}, indent=2), encoding='utf-8')
    finally:
        browser.close()
