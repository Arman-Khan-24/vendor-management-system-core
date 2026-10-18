"""Redesign acceptance against a disposable local API and a production preview.

Run ui_acceptance.py first to create synthetic business data and browser state.
Requires Playwright/Chromium and pypdf. Large-list and long-invoice fixtures are
intercepted GET responses; their records are never written to the database.
"""
import argparse
import copy
import csv
import io
import json
import statistics
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:5175")
parser.add_argument("--api-url", default="http://127.0.0.1:5100")
args = parser.parse_args()
for address in [args.base_url, args.api_url]:
    if urlparse(address).hostname not in ["localhost", "127.0.0.1"]:
        raise SystemExit("Use disposable loopback servers only.")
out = Path(tempfile.gettempdir()) / "orderledger-redesign-qa"
out.mkdir(exist_ok=True)
state = json.loads((Path(tempfile.gettempdir()) / "orderledger-ui-qa/browser-state.json").read_text())
token = next(item["value"] for origin in state["origins"] for item in origin["localStorage"] if item["name"] == "orderledger_token")
checks, errors, metrics = [], [], {}


def passed(name):
    checks.append(name)
    print("PASS " + name, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
    context.add_init_script("localStorage.setItem('orderledger_token', " + json.dumps(token) + "); localStorage.setItem('orderledger_api_url', " + json.dumps(args.api_url) + ");")
    context.set_default_timeout(20000)
    expect.set_options(timeout=20000)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))

    def api(path, method="GET", data=None):
        response = context.request.fetch(args.api_url + "/api" + path, method=method, data=data, headers={"Authorization": "Bearer " + token})
        assert response.ok, f"Synthetic API {method} {path}: {response.status} {response.text()}"
        return response.json()

    def nav(label):
        if page.viewport_size["width"] <= 740:
            mobile = page.get_by_role("navigation", name="Mobile navigation", exact=True)
            target = mobile.get_by_role("button", name=label, exact=True)
            if target.count():
                target.click()
            else:
                mobile.get_by_role("button", name="More", exact=True).click()
                page.get_by_role("dialog", name="Your workspace").get_by_role("button", name=label, exact=True).click()
        else:
            page.get_by_role("navigation", name="Main navigation", exact=True).get_by_role("button", name=label, exact=True).click()

    def capture(name):
        notification = page.get_by_role("button", name="Dismiss notification")
        if notification.count():
            notification.click()
        page.screenshot(path=str(out / (name + ".png")), full_page=page.locator("dialog[open]").count() == 0, animations="disabled")

    def no_overflow():
        overflow = page.evaluate("document.documentElement.scrollWidth - innerWidth")
        assert overflow <= 1, f"Page overflow: {overflow}px at {page.viewport_size}"

    try:
        products = api("/products?all=true")
        customer = api("/customers", "POST", {"name": "Juniper Market " + str(int(time.time()))[-4:], "phone": "91" + str(int(time.time())), "creditTermsDays": 7})
        order = api("/orders", "POST", {"customerId": customer["id"], "items": [{"productId": products[0]["id"], "quantity": 2}]})
        for status in ["Packed", "Delivered"]:
            api("/orders/" + order["id"] + "/status", "PATCH", {"status": status})
        invoice = next(i for i in api("/invoices") if i["order_id"] == order["id"])
        invoice_number = invoice.get("invoice_prefix", "CM") + "-" + str(invoice["invoice_no"]).zfill(4)

        page.goto(args.base_url, wait_until="networkidle")
        expect(page.get_by_role("heading", name="Your business, in balance.")).to_be_visible()
        pending = page.locator(".waiting-card").filter(has_text=invoice_number)
        pending.get_by_role("button", name="Record payment", exact=True).click()
        dialog = page.get_by_role("dialog", name="Record a payment")
        expect(dialog.get_by_label("Customer", exact=True)).to_have_value(customer["id"])
        dialog.get_by_role("button", name="Cancel", exact=True).click()
        page.locator(".dashboard-activity").get_by_role("button", name="Invoices", exact=True).click()
        page.get_by_role("button", name="Open invoice " + invoice_number, exact=True).click()
        expect(page.get_by_role("table", name="Invoice items")).to_be_visible()
        assert page.evaluate("!!document.activeElement.closest('dialog')"), "Invoice focus must stay in its dialog"
        page.keyboard.press("Tab")
        assert page.evaluate("!!document.activeElement.closest('dialog')"), "Invoice keyboard focus escaped"
        page.get_by_role("button", name="Close dialog", exact=True).click()
        page.locator(".collection-card").first.click()
        expect(page.get_by_role("dialog", name="Customer statement")).to_be_visible()
        page.get_by_role("button", name="Close dialog", exact=True).click()
        ring_icon = page.locator(".ring-center > svg").bounding_box()
        assert ring_icon and ring_icon["width"] == 20 and ring_icon["height"] == 20
        passed("Dashboard invoice, customer-specific payment and statement shortcuts")

        search = page.get_by_role("searchbox", name="Find a workspace page")
        search.fill("invoices")
        search.press("Enter")
        expect(page.get_by_role("heading", name="Your invoices.", exact=True)).to_be_visible()
        search.fill("no-such-page")
        expect(page.get_by_text('No matching pages. Try “Orders” or “Catalog”.')).to_be_visible()
        search.press("Escape")
        expect(search).to_have_value("")
        passed("Workspace search supports Enter, empty results and Escape")

        settings = api("/business")["settings"]
        for theme in ["dark", "light"]:
            changed = copy.deepcopy(settings)
            changed["branding"]["theme"] = theme
            api("/business", "PATCH", {"settings": changed})
            page.reload(wait_until="networkidle")
            expect(page.locator("html")).to_have_attribute("data-theme", theme)
            nav("Overview")
            capture("dashboard-" + theme)
            for width in [1440, 900, 768, 740, 560, 390, 375, 320]:
                page.set_viewport_size({"width": width, "height": 844 if width < 768 else 1000})
                for label in ["Overview", "Catalog", "Customers", "Orders", "Invoices", "Payments", "Reports", "Settings"]:
                    nav(label)
                    no_overflow()
                if width == 390:
                    nav("Overview")
                    capture("dashboard-mobile-" + theme)
            page.set_viewport_size({"width": 1440, "height": 1000})
        passed("Eight screens at eight widths from 320px to 1440px in light/dark")

        nav("Overview")
        page.emulate_media(reduced_motion="reduce")
        assert page.locator(".page-stack").evaluate("el => parseFloat(getComputedStyle(el).animationDuration)") < 0.001
        page.emulate_media(reduced_motion="no-preference")
        nav("Invoices")
        page.get_by_role("button", name=invoice_number, exact=True).click()
        expect(page.get_by_role("table", name="Invoice items")).to_be_visible()
        page.locator(".invoice-banner").evaluate("image => image.decode()")
        capture("invoice-desktop")
        for width in [740, 390, 320]:
            page.set_viewport_size({"width": width, "height": 844})
            no_overflow()
            assert page.locator("dialog[open]").evaluate("el => el.scrollWidth <= el.clientWidth + 1")
            assert page.locator("dialog[open]").evaluate("el => el.getBoundingClientRect().top >= 0 && el.getBoundingClientRect().bottom <= innerHeight + 1")
            if width == 390:
                capture("invoice-mobile")
        page.set_viewport_size({"width": 1440, "height": 1000})
        page.emulate_media(media="print")
        assert page.locator("dialog[open]").evaluate("el => getComputedStyle(el, '::backdrop').display") == "none"
        page.pdf(path=str(out / "invoice.pdf"), format="A4", print_background=True)
        page.emulate_media(media="screen")
        pdf = PdfReader(out / "invoice.pdf")
        assert len(pdf.pages) == 1, f"Short invoice should fit one page, got {len(pdf.pages)}"
        assert invoice_number in pdf.pages[0].extract_text()
        page.get_by_role("button", name="Close dialog", exact=True).click()
        passed("Reduced motion, responsive invoice and one-page A4 invoice")

        # A long printable invoice uses fixture lines so the live test ledger stays small.
        long_invoice = api("/invoices/" + invoice["id"])
        long_invoice["items"] = [dict(long_invoice["items"][0], product_name=f"Print line {i:03d} - Garden produce", quantity=1, unit_price=10, total=10) for i in range(1, 81)]
        long_invoice.update(subtotal=800, tax=40, tax_rate=5, total=840, remaining_amount=840, allocated_amount=0)
        invoice_url = "**/api/invoices/" + invoice["id"]
        page.route(invoice_url, lambda route: route.fulfill(json=long_invoice))
        page.get_by_role("button", name=invoice_number, exact=True).click()
        expect(page.locator(".invoice-table tbody tr")).to_have_count(80)
        page.locator(".invoice-banner").evaluate("image => image.decode()")
        page.emulate_media(media="print")
        page.pdf(path=str(out / "invoice-long.pdf"), format="A4", print_background=True)
        page.emulate_media(media="screen")
        pdf = PdfReader(out / "invoice-long.pdf")
        all_text = "\n".join(part.extract_text() for part in pdf.pages)
        for i in range(1, 81):
            assert f"Print line {i:03d}" in all_text, f"Missing printed line {i}"
        assert "Balance due" in all_text and len(pdf.pages) > 1
        metrics["long_invoice_pages"] = len(pdf.pages)
        page.get_by_role("button", name="Close dialog", exact=True).click()
        page.unroute(invoice_url)
        passed("All 80 invoice lines and totals survive multi-page printing")

        fixtures = {}
        for endpoint in ["products", "customers", "orders", "payments", "invoices"]:
            seed = api("/" + endpoint)[0]
            fixtures[endpoint] = []
            for i in range(1000):
                item = dict(seed, id=str(uuid.UUID(int=i + 1000)))
                if endpoint == "products":
                    item.update(name=f"Load product {i:04d}", active=True)
                elif endpoint == "customers":
                    item.update(name=f"Load customer {i:04d}", active=True)
                else:
                    item["customer_name"] = f"Load customer {i:04d}"
                    if endpoint == "orders": item["order_no"] = i + 1
                    if endpoint == "invoices": item["invoice_no"] = i + 1
                    if endpoint == "payments": item["reference"] = f"Load payment {i:04d}"
                fixtures[endpoint].append(item)

        def lists(route):
            url = urlparse(route.request.url)
            endpoint = url.path.rsplit("/", 1)[-1]
            if route.request.method != "GET" or endpoint not in fixtures:
                route.continue_()
                return
            query = parse_qs(url.query)
            offset = int(query.get("offset", [0])[0])
            limit = int(query.get("limit", [500])[0])
            route.fulfill(json=fixtures[endpoint][offset:offset + limit])

        page.route("**/api/**", lists)
        page.reload(wait_until="networkidle")
        for label, search_label, row_selector in [
            ("Catalog", "Search catalog", ".record-row"),
            ("Customers", "Search customers", ".customer-card"),
            ("Orders", "Search orders", ".record-row"),
            ("Payments", "Search payments", ".record-row"),
            ("Invoices", "Search invoices", ".record-row"),
        ]:
            nav(label)
            expect(page.locator(row_selector)).to_have_count(24)
            pagination = page.get_by_role("navigation", name="Record pages")
            expect(pagination).to_contain_text("1–24 of 1000")
            pagination.get_by_role("button", name="Next", exact=True).click()
            expect(pagination).to_contain_text("25–48 of 1000")
            search = page.get_by_role("searchbox", name=search_label)
            search.fill("Load product 0999" if label == "Catalog" else "Load payment 0999" if label == "Payments" else "Load customer 0999")
            expect(page.locator(row_selector)).to_have_count(1)
            search.fill("")
            expect(pagination).to_contain_text("1–24 of 1000")
            with page.expect_download() as download:
                page.get_by_role("button", name="Export invoices" if label == "Invoices" else "Export", exact=True).click()
            contents = Path(download.value.path()).read_text(encoding="utf-8-sig")
            assert len(list(csv.reader(io.StringIO(contents)))) == 1001
        passed("Five 1,000-record lists: 24 rendered, all searchable, page reset and full exports")

        samples = []
        for label in ["Catalog", "Customers", "Orders", "Payments", "Invoices"] * 3:
            duration = page.evaluate("""label => new Promise(resolve => {
              const button = [...document.querySelectorAll('nav[aria-label="Main navigation"] button')].find(el => el.textContent.trim() === label);
              const start = performance.now(); button.click();
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
            })""", label)
            samples.append(round(duration, 1))
        metrics["navigation_click_to_frame_ms"] = {"samples": samples, "median": round(statistics.median(samples), 1), "max": max(samples)}
        metrics["dom_elements_after_navigation"] = page.locator("*").count()
        metrics["resource_bytes"] = page.evaluate("performance.getEntriesByType('resource').filter(r => /\\.(js|css|woff2)/.test(r.name)).reduce((n, r) => n + r.decodedBodySize, 0)")
        passed("Production-preview navigation measurements collected with 5,000 loaded records")
        assert not errors, "Browser errors: " + " | ".join(errors)
        passed("No uncaught browser exceptions")
        (out / "results.json").write_text(json.dumps({"checks": checks, "metrics": metrics, "errors": errors}, indent=2), encoding="utf-8")
        print(json.dumps(metrics), flush=True)
        print(f"COMPLETE: {len(checks)} redesign checks. Artifacts: {out}", flush=True)
    except Exception:
        capture("failure")
        (out / "failure-page.txt").write_text(page.locator("body").inner_text(), encoding="utf-8")
        raise
    finally:
        context.close()
        browser.close()
