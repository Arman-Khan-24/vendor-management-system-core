"""Decode invoice/statement QRs and verify manual payment flow on disposable local servers.

Requires Playwright, Pillow and zxing-cpp. Never performs a bank transfer.
"""
import argparse
import base64
import io
import json
import secrets
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from PIL import Image
import zxingcpp
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:5176')
parser.add_argument('--api-url', default='http://127.0.0.1:5100')
args = parser.parse_args()
for address in [args.base_url, args.api_url]:
    if urlparse(address).hostname not in ['localhost', '127.0.0.1']:
        raise SystemExit('Use disposable loopback servers only.')
out = Path('/tmp/orderledger-upi-qa')
out.mkdir(exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True)
    context.set_default_timeout(30000)
    expect.set_options(timeout=30000)
    stamp = secrets.token_hex(6)
    response = context.request.post(args.api_url + '/api/auth/register', data={
        'businessName': 'UPI QA Market', 'businessSlug': 'upi-qa-' + stamp,
        'ownerName': 'QA Owner', 'email': stamp + '@example.test',
        'password': secrets.token_hex(16), 'categoryTemplate': 'custom',
    })
    assert response.status == 201
    token = response.json()['token']
    def api(path, data=None, method=None):
        response = context.request.fetch(args.api_url + '/api' + path,
            method=method or ('GET' if data is None else 'POST'), data=data,
            headers={'Authorization': 'Bearer ' + token})
        assert response.ok, f'{path}: {response.status} {response.text()}'
        return response.json()
    customer = api('/customers', {'name': 'UPI QA Cafe', 'phone': '9000000041'})
    product = api('/products', {'name': 'Produce box', 'unit': 'box', 'currentPrice': 100})
    invoices = []
    for quantity in [3, 2]:
        order = api('/orders', {'customerId': customer['id'], 'items': [{'productId': product['id'], 'quantity': quantity}]})
        invoices.append(api('/invoices/order/' + order['id'] + '/generate', {}))
    number = (invoices[0].get('invoice_prefix') or 'INV') + '-' + str(invoices[0]['invoice_no']).zfill(4)
    context.add_init_script('localStorage.setItem("orderledger_token", ' + json.dumps(token) + '); localStorage.setItem("orderledger_api_url", ' + json.dumps(args.api_url) + ');')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    def nav(name):
        page.get_by_role('navigation', name='Main navigation').get_by_role('button', name=name, exact=True).click()
    def invoice():
        nav('Invoices')
        page.get_by_role('button', name=number, exact=True).click()
        dialog = page.get_by_role('dialog', name=number, exact=True)
        expect(dialog.locator('.invoice-sheet')).to_be_visible()
        return dialog
    def decode(panel, amount, receiver):
        image = panel.locator('img.upi-qr')
        expect(image).to_be_visible()
        png = base64.b64decode(image.get_attribute('src').split(',', 1)[1])
        barcode = zxingcpp.read_barcode(Image.open(io.BytesIO(png)))
        assert barcode is not None
        uri = urlparse(barcode.text)
        assert uri.scheme == 'upi' and uri.netloc == 'pay'
        params = parse_qs(uri.query)
        assert params['pa'] == [receiver] and params['am'] == [amount] and params['cu'] == ['INR'], params
        return params
    try:
        page.goto(args.base_url, wait_until='networkidle', timeout=90000)
        dialog = invoice()
        panel = dialog.get_by_role('region', name='UPI payment QR')
        params = decode(panel, '300.00', 'demo@orderledger')
        assert number in params['tn'][0]
        expect(panel).to_contain_text('cannot receive payments')
        expect(panel.get_by_role('link', name='Open UPI app')).to_have_count(0)
        with page.expect_download() as downloaded:
            panel.get_by_role('link', name='Download demo QR').click()
        downloaded.value.save_as(str(out / 'demo-300.png'))
        assert zxingcpp.read_barcode(Image.open(out / 'demo-300.png')).text.startswith('upi://pay?')
        assert api('/payments') == []
        assert api('/invoices/' + invoices[0]['id'])['status'] == 'Pending'
        print('PASS Demo QR decodes to 300, downloads and never marks the invoice paid', flush=True)
        dialog.get_by_role('button', name='Close dialog').click()

        nav('Settings')
        page.get_by_role('navigation', name='Settings sections').get_by_role('button', name='Billing & payments', exact=True).click()
        page.get_by_label('Merchant UPI ID', exact=True).fill('qa.market@bank')
        page.get_by_label('UPI payee name', exact=True).fill('QA Market')
        decode(page.get_by_role('region', name='UPI payment QR'), '300.00', 'qa.market@bank')
        page.get_by_role('button', name='Save changes', exact=True).click()
        expect(page.get_by_text('All changes saved.', exact=True)).to_be_visible()
        assert api('/business')['settings']['billing']['upiId'] == 'qa.market@bank'
        page.reload(wait_until='networkidle')
        nav('Settings')
        page.get_by_role('navigation', name='Settings sections').get_by_role('button', name='Billing & payments', exact=True).click()
        expect(page.get_by_label('Merchant UPI ID', exact=True)).to_have_value('qa.market@bank')
        print('PASS Merchant UPI details save and survive reload', flush=True)

        page.get_by_role('navigation', name='Settings sections').get_by_role('button', name='Blueprints', exact=True).click()
        with page.expect_download() as downloaded:
            page.get_by_role('button', name='Export blueprint', exact=True).click()
        blueprint = json.loads(Path(downloaded.value.path()).read_text())
        assert 'upiId' not in blueprint['settings']['billing'] and 'upiPayeeName' not in blueprint['settings']['billing']
        blueprint['settings']['billing']['upiId'] = 'other@bank'
        blueprint['settings']['billing']['upiPayeeName'] = 'Other merchant'
        page.get_by_label('Import a blueprint', exact=True).set_input_files({'name': 'blueprint.json', 'mimeType': 'application/json', 'buffer': json.dumps(blueprint).encode()})
        page.get_by_role('dialog', name='Preview blueprint').get_by_role('button', name='Apply to settings').click()
        page.get_by_role('navigation', name='Settings sections').get_by_role('button', name='Billing & payments', exact=True).click()
        expect(page.get_by_label('Merchant UPI ID', exact=True)).to_have_value('qa.market@bank')
        expect(page.get_by_label('UPI payee name', exact=True)).to_have_value('QA Market')
        page.get_by_role('button', name='Save changes', exact=True).click()
        expect(page.get_by_text('All changes saved.', exact=True)).to_be_visible()
        assert api('/business')['settings']['billing']['upiId'] == 'qa.market@bank'
        print('PASS Blueprint export excludes the receiver and import cannot replace it', flush=True)

        dialog = invoice()
        panel = dialog.get_by_role('region', name='UPI payment QR')
        params = decode(panel, '300.00', 'qa.market@bank')
        assert params['pn'] == ['QA Market'] and number in params['tn'][0]
        assert parse_qs(urlparse(panel.get_by_role('link', name='Open UPI app').get_attribute('href')).query) == params
        with page.expect_download() as downloaded:
            panel.get_by_role('link', name='Download payment QR').click()
        downloaded.value.save_as(str(out / 'merchant-300.png'))
        assert parse_qs(urlparse(zxingcpp.read_barcode(Image.open(out / 'merchant-300.png')).text).query) == params
        page.emulate_media(media='print')
        expect(panel.locator('img.upi-qr')).to_be_visible()
        expect(panel.get_by_role('link', name='Download payment QR')).not_to_be_visible()
        page.screenshot(path=str(out / 'invoice-print.png'), full_page=True)
        page.emulate_media(media='screen')
        page.set_viewport_size({'width': 375, 'height': 667})
        panel.scroll_into_view_if_needed()
        assert dialog.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        panel.locator('img.upi-qr').screenshot(path=str(out / 'rendered-mobile-qr.png'))
        assert parse_qs(urlparse(zxingcpp.read_barcode(Image.open(out / 'rendered-mobile-qr.png')).text).query) == params
        page.screenshot(path=str(out / 'invoice-mobile.png'), full_page=True)
        assert api('/payments') == []
        print('PASS Merchant QR has exact receiver, amount and reference in image/link/download; mobile and print fit', flush=True)
        page.set_viewport_size({'width': 1366, 'height': 900})
        dialog.get_by_role('button', name='Record payment', exact=True).click()
        payment = page.get_by_role('dialog', name='Record a payment', exact=True)
        payment.get_by_label('Amount received').fill('100')
        payment.get_by_label('Payment method').select_option('upi')
        payment.get_by_role('button', name='Save payment', exact=True).click()
        expect(payment).not_to_be_visible()
        page.reload(wait_until='networkidle')
        dialog = invoice()
        decode(dialog.get_by_role('region', name='UPI payment QR'), '200.00', 'qa.market@bank')
        assert api('/invoices/' + invoices[0]['id'])['status'] == 'Partial'
        print('PASS Manually recording 100 reduces the invoice QR from 300 to 200', flush=True)
        dialog.get_by_role('button', name='Statement', exact=True).click()
        statement = page.get_by_role('dialog', name='Customer statement', exact=True)
        decode(statement.get_by_role('region', name='UPI payment QR'), '400.00', 'qa.market@bank')
        statement.get_by_label('Statement from').fill('2020-01-01')
        statement.get_by_label('Statement to').fill('2020-01-02')
        statement.get_by_role('button', name='Apply', exact=True).click()
        expect(statement.get_by_text('No transactions in this period.', exact=True)).to_be_visible()
        decode(statement.get_by_role('region', name='UPI payment QR'), '400.00', 'qa.market@bank')
        print('PASS Customer QR combines all current unpaid bills, even with a historical date filter', flush=True)
        statement.get_by_role('button', name='Close', exact=True).click()
        api('/payments', {'customerId': customer['id'], 'amount': 400, 'mode': 'upi'})
        page.reload(wait_until='networkidle')
        dialog = invoice()
        expect(dialog.get_by_role('region', name='UPI payment QR')).to_have_count(0)
        expect(dialog).to_contain_text('fully paid')
        dialog.get_by_role('button', name='Statement', exact=True).click()
        statement = page.get_by_role('dialog', name='Customer statement', exact=True)
        expect(statement.get_by_role('region', name='UPI payment QR')).to_have_count(0)
        assert not errors, errors
        print('PASS Fully settled invoice/customer hide payable QRs; no browser exceptions', flush=True)
    except Exception:
        page.screenshot(path=str(out / 'failure.png'), full_page=True)
        (out / 'failure.txt').write_text(page.locator('body').inner_text())
        raise
    finally:
        browser.close()
