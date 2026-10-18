"""Settings regressions against a disposable loopback API and built frontend.

Run with the backend's dev:isolated server and a frontend built for that API.
Creates a synthetic account; never run against a customer database.
"""
import argparse
import json
import secrets
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:5175')
parser.add_argument('--api-url', default='http://127.0.0.1:5100')
args = parser.parse_args()
for address in [args.base_url, args.api_url]:
    if urlparse(address).hostname not in ['localhost', '127.0.0.1']:
        raise SystemExit('Use disposable loopback servers only.')
out = Path(tempfile.gettempdir()) / 'orderledger-settings-qa'
out.mkdir(exist_ok=True)
checks = []


def passed(name):
    checks.append(name)
    print('PASS ' + name, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.set_default_timeout(20000)
    expect.set_options(timeout=20000)
    stamp = secrets.token_hex(6)
    registered = context.request.post(args.api_url + '/api/auth/register', data={
        'businessName': 'Settings QA', 'businessSlug': 'settings-qa-' + stamp,
        'categoryTemplate': 'custom', 'ownerName': 'Test Owner',
        'email': 'settings-' + stamp + '@example.test', 'password': secrets.token_hex(16),
    })
    assert registered.status == 201
    token = registered.json()['token']
    context.add_init_script("localStorage.setItem('orderledger_token', " + json.dumps(token) + "); localStorage.setItem('orderledger_api_url', " + json.dumps(args.api_url) + ');')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def api(path='/api/business', body=None):
        response = context.request.fetch(args.api_url + path, method='GET' if body is None else 'PATCH', data=body, headers={'Authorization': 'Bearer ' + token})
        assert response.ok, f'{path}: {response.status}'
        return response.json()

    def section(name):
        page.get_by_role('navigation', name='Settings sections').get_by_role('button', name=name, exact=True).click()

    def settings():
        page.get_by_role('navigation', name='Main navigation', exact=True).get_by_role('button', name='Settings', exact=True).click()

    def save():
        with page.expect_response(lambda response: response.url == args.api_url + '/api/business' and response.request.method == 'PATCH') as response:
            page.get_by_role('button', name='Save changes', exact=True).click()
        assert response.value.status == 200, response.value.text()
        expect(page.get_by_text('All changes saved.', exact=True)).to_be_visible()
        return response.value.request.post_data_json

    try:
        page.goto(args.base_url, wait_until='networkidle')
        settings()
        page.get_by_label('Business name', exact=True).fill('Settings Market')
        page.get_by_label('Business email', exact=True).fill('settings@example.test')
        page.get_by_label('Business address', exact=True).fill('Nagpur test address')
        page.get_by_label('Tax registration number', exact=True).fill('TEST-GSTIN')
        save()
        loaded = api()
        assert loaded['name'] == 'Settings Market'
        assert loaded['settings']['profile']['address'] == 'Nagpur test address'
        assert loaded['settings']['profile']['taxId'] == 'TEST-GSTIN'
        page.reload(wait_until='networkidle')
        settings()
        expect(page.get_by_label('Business email', exact=True)).to_have_value('settings@example.test')
        passed('Business profile fields persist through reload')

        section('Appearance')
        page.get_by_label('App name', exact=True).fill('Settings Ledger')
        page.get_by_label('Tagline', exact=True).fill('Saved appearance')
        save()
        for accent in ['Lavender', 'Peach', 'Sky', 'Sage']:
            page.get_by_role('button', name=accent, exact=True).click()
            payload = save()
            assert payload == {'settings': {'branding': {'accent': accent.lower()}}}
            expect(page.locator('html')).to_have_attribute('data-accent', accent.lower())
        for theme in ['dark', 'light', 'system']:
            page.get_by_label('Default theme', exact=True).select_option(theme)
            save()
            assert api()['settings']['branding']['theme'] == theme
        page.emulate_media(color_scheme='dark')
        expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
        page.emulate_media(color_scheme='light')
        expect(page.locator('html')).to_have_attribute('data-theme', 'light')
        passed('All four palettes and three themes save and apply, including device changes')

        # A second tab changes independent fields after this tab loaded its draft.
        api(body={'settings': {'branding': {'tagline': 'Changed in another tab'}, 'profile': {'address': 'Concurrent address'}}})
        page.get_by_label('Default theme', exact=True).select_option('dark')
        assert save() == {'settings': {'branding': {'theme': 'dark'}}}
        loaded = api()
        assert loaded['settings']['branding']['tagline'] == 'Changed in another tab'
        assert loaded['settings']['profile']['address'] == 'Concurrent address'
        passed('Appearance saves preserve independent changes made by another tab')

        section('Catalog & labels')
        page.get_by_label('Available units', exact=True).fill('piece, carton')
        page.get_by_label('Default unit for new products', exact=True).select_option('carton')
        page.get_by_label('Catalog categories', exact=True).fill('Dry goods, Fresh goods')
        page.get_by_label('Products page label', exact=True).fill('Goods')
        save()
        section('Billing & payments')
        page.get_by_label('Invoice prefix', exact=True).fill('QA')
        page.get_by_label('Default payment terms (days)', exact=True).fill('14')
        page.get_by_label('Tax rate (%)', exact=True).fill('5.25')
        page.get_by_label('Create invoice when', exact=True).select_option('Packed')
        page.get_by_label('Invoice footer', exact=True).fill('Test invoice footer')
        save()
        loaded = api()
        assert loaded['settings']['catalog']['defaultUnit'] == 'carton'
        assert loaded['settings']['catalog']['categories'] == ['Dry goods', 'Fresh goods']
        assert loaded['settings']['billing']['taxRate'] == 5.25
        assert loaded['settings']['billing']['defaultCreditTermsDays'] == 14
        assert loaded['invoice_trigger'] == 'Packed'
        passed('Catalog and billing settings save through the real API')

        page.get_by_label('Invoice prefix', exact=True).fill('BAD_PREFIX')
        page.get_by_role('button', name='Save changes', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('settings.billing.invoicePrefix')
        expect(page.get_by_role('alert')).to_contain_text('Use letters, numbers')
        expect(page.get_by_label('Invoice prefix', exact=True)).to_have_value('BAD_PREFIX')
        page.route('**/api/business', lambda route: route.fulfill(status=400, json={'error': 'Validation error', 'details': [{'path': ['settings', 'billing', 'invoicePrefix'], 'message': 'Array path error'}]}) if route.request.method == 'PATCH' else route.continue_())
        page.get_by_role('button', name='Save changes', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('settings.billing.invoicePrefix: Array path error')
        page.unroute('**/api/business')
        page.get_by_role('button', name='Discard', exact=True).click()
        passed('String and array validation paths show the field error and preserve drafts')

        section('Connections')
        expect(page.get_by_label('Backend API address', exact=True)).to_be_visible()
        page.get_by_label('Primary model', exact=True).fill('unsaved-model')
        section('Appearance')
        page.get_by_label('Tagline', exact=True).fill('Saved while provider draft exists')
        save()
        page.get_by_role('navigation', name='Main navigation', exact=True).get_by_role('button', name='Overview', exact=True).click()
        expect(page.get_by_role('dialog', name='Unsaved settings')).to_be_visible()
        page.get_by_role('button', name='Keep editing', exact=True).click()
        section('Connections')
        expect(page.get_by_label('Primary model', exact=True)).to_have_value('unsaved-model')
        page.route('**/api/business/connections', lambda route: route.fulfill(status=503, json={'error': 'Temporary connection failure'}) if route.request.method == 'PATCH' else route.continue_())
        page.get_by_role('button', name='Save provider connections', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('Temporary connection failure')
        expect(page.get_by_label('Primary model', exact=True)).to_have_value('unsaved-model')
        page.unroute('**/api/business/connections')
        api('/api/business/connections', {'fallback': {'model': 'Changed in another tab'}})
        page.get_by_role('button', name='Save provider connections', exact=True).click()
        expect(page.get_by_text('Connections saved.', exact=False)).to_be_visible()
        assert api('/api/business/connections')['primary']['model'] == 'unsaved-model'
        assert api('/api/business/connections')['fallback']['model'] == 'Changed in another tab'
        page.get_by_label('Primary model', exact=True).fill('discard-me')
        page.get_by_role('button', name='Discard provider changes', exact=True).click()
        expect(page.get_by_label('Primary model', exact=True)).to_have_value('unsaved-model')
        page.get_by_label('Backend API address', exact=True).fill('http://127.0.0.1:5999')
        page.get_by_role('navigation', name='Main navigation', exact=True).get_by_role('button', name='Overview', exact=True).click()
        expect(page.get_by_role('dialog', name='Unsaved settings')).to_be_visible()
        page.get_by_role('button', name='Keep editing', exact=True).click()
        page.get_by_label('Backend API address', exact=True).fill(args.api_url)
        passed('Provider drafts survive section changes, business saves and failures; navigation is guarded')

        page.get_by_role('button', name='Test connection', exact=True).click()
        expect(page.get_by_text('Connection verified.', exact=False)).to_be_visible()
        page.route('**/health', lambda route: route.fulfill(status=503, json={'status': 'unavailable'}))
        page.get_by_role('button', name='Test connection', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('Server setup is not ready (503)')
        expect(page.get_by_text('Connection verified.', exact=False)).to_have_count(0)
        page.unroute('**/health')
        page.route('**/health', lambda route: route.fulfill(status=200, json={'status': 'ok', 'service': 'OrderLedger Core API'}))
        page.get_by_role('button', name='Test connection', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('older or incompatible OrderLedger API')
        page.unroute('**/health')
        passed('Connection test checks database readiness and rejects incomplete setup')

        section('Appearance')
        page.get_by_label('Tagline', exact=True).fill('Retain after server failure')
        page.route('**/api/business', lambda route: route.fulfill(status=500, json={'error': 'Internal server error'}) if route.request.method == 'PATCH' else route.continue_())
        page.get_by_role('button', name='Save changes', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('Internal server error')
        expect(page.get_by_label('Tagline', exact=True)).to_have_value('Retain after server failure')
        page.get_by_role('button', name='Check server connection', exact=True).click()
        expect(page.get_by_label('Backend API address', exact=True)).to_be_visible()
        page.unroute('**/api/business')
        section('Appearance')
        save()
        assert api()['settings']['branding']['tagline'] == 'Retain after server failure'
        page.set_viewport_size({'width': 390, 'height': 844})
        section('Connections')
        expect(page.get_by_label('Backend API address', exact=True)).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        page.set_viewport_size({'width': 1440, 'height': 1000})
        # The production incident was a newer UI talking to an older API.
        legacy = api()
        legacy.pop('settings')
        page.route('**/api/auth/me', lambda route: route.fulfill(json={'user': registered.json()['user'], 'business': legacy}))
        page.reload(wait_until='networkidle')
        settings()
        expect(page.get_by_role('alert')).to_contain_text('older OrderLedger backend')
        page.get_by_label('Business name', exact=True).fill('Must not silently save')
        expect(page.get_by_role('button', name='Save changes', exact=True)).to_be_disabled()
        page.unroute('**/api/auth/me')
        page.reload(wait_until='networkidle')
        settings()
        section('Appearance')
        page.get_by_label('Tagline', exact=True).fill('Keep if an old API ignores this')
        page.route('**/api/business', lambda route: route.fulfill(json=legacy) if route.request.method == 'PATCH' else route.continue_())
        page.get_by_role('button', name='Save changes', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('did not return saved settings')
        expect(page.get_by_label('Tagline', exact=True)).to_have_value('Keep if an old API ignores this')
        page.unroute('**/api/business')
        assert not errors, errors
        passed('Server failures and legacy APIs retain drafts, expose Connections and cannot report false saves')
        (out / 'results.json').write_text(json.dumps({'checks': checks, 'browser_errors': errors}, indent=2), encoding='utf-8')
        print(f'COMPLETE: {len(checks)} settings checks. Artifacts: {out}', flush=True)
    except Exception:
        page.screenshot(path=str(out / 'failure.png'), full_page=True)
        (out / 'failure.txt').write_text(page.locator('body').inner_text(), encoding='utf-8')
        raise
    finally:
        context.close()
        browser.close()
