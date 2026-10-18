"""Focused acceptance of blueprint application, failed saves and server switching."""
import argparse
import json
import tempfile
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:5174')
args = parser.parse_args()
if urlparse(args.base_url).hostname not in ['localhost', '127.0.0.1']:
    raise SystemExit('Use a disposable loopback server only.')
out = Path(tempfile.gettempdir()) / "orderledger-ui-qa"
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(storage_state=str(out / "browser-state.json"), viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    page.set_default_timeout(20000)
    page.goto(args.base_url, wait_until="networkidle")
    nav = page.get_by_role("navigation", name="Main navigation", exact=True)
    nav.get_by_role("button", name="Settings", exact=True).click()
    sections = page.get_by_role("navigation", name="Settings sections")
    sections.get_by_role("button", name="Blueprints", exact=True).click()
    blueprint = json.loads((out / "blueprint.json").read_text(encoding="utf8"))
    blueprint["settings"]["catalog"]["productLabel"] = "Produce"
    imported = out / "import-blueprint.json"
    imported.write_text(json.dumps(blueprint), encoding="utf8")
    page.get_by_label("Import a blueprint", exact=True).set_input_files(str(imported))
    page.get_by_role("dialog", name="Preview blueprint").get_by_role("button", name="Apply to settings").click()
    page.get_by_role("button", name="Save changes", exact=True).click()
    expect(page.get_by_text("All changes saved.", exact=True)).to_be_visible()
    expect(nav.get_by_role("button", name="Produce", exact=True)).to_be_visible()
    nav.get_by_role("button", name="Produce", exact=True).click()
    expect(page.get_by_text("Fresh tomatoes", exact=True)).to_be_visible()
    nav.get_by_role("button", name="Invoices", exact=True).click()
    expect(page.get_by_text("CM-0001", exact=True)).to_be_visible()
    print("PASS Blueprint import applies configuration and preserves products/invoices", flush=True)
    nav.get_by_role("button", name="Settings", exact=True).click()
    sections.get_by_role("button", name="Catalog & labels", exact=True).click()
    page.get_by_label("Products page label", exact=True).fill("Products")
    page.get_by_role("button", name="Save changes", exact=True).click()
    expect(page.get_by_text("All changes saved.", exact=True)).to_be_visible()

    def fail_save(route):
        if route.request.method == "POST":
            route.fulfill(status=503, content_type="application/json", body=json.dumps({"error": "Temporary server failure. Try again."}))
        else:
            route.continue_()

    page.route("**/api/orders", fail_save)
    page.get_by_role("banner").get_by_role("button", name="New order", exact=True).click()
    dialog = page.get_by_role("dialog", name="Create an order")
    dialog.get_by_label("Order notes", exact=True).fill("Keep this order draft")
    dialog.get_by_role("button", name="Create order", exact=True).click()
    expect(dialog.get_by_role("alert")).to_contain_text("Temporary server failure")
    expect(dialog.get_by_label("Order notes", exact=True)).to_have_value("Keep this order draft")
    dialog.get_by_role("button", name="Cancel", exact=True).click()
    page.unroute("**/api/orders", fail_save)

    nav.get_by_role("button", name="Payments", exact=True).click()
    page.route("**/api/payments", fail_save)
    page.get_by_role("button", name="Record payment", exact=True).click()
    dialog = page.get_by_role("dialog", name="Record a payment")
    dialog.get_by_label("Amount received", exact=True).fill("10.25")
    dialog.get_by_role("button", name="Save payment", exact=True).click()
    expect(dialog.get_by_role("alert")).to_contain_text("Temporary server failure")
    expect(dialog.get_by_label("Amount received", exact=True)).to_have_value("10.25")
    dialog.get_by_role("button", name="Cancel", exact=True).click()
    page.unroute("**/api/payments", fail_save)
    print("PASS Failed order/payment saves retain form values and display errors", flush=True)

    page.set_viewport_size({"width": 390, "height": 844})
    mobile = page.get_by_role("navigation", name="Mobile navigation")
    mobile.get_by_role("button", name="More", exact=True).click()
    page.keyboard.press("Tab")
    assert page.evaluate("!!document.activeElement.closest('dialog')")
    page.keyboard.press("Escape")
    print("FOCUS after Escape:", page.evaluate("document.activeElement.getAttribute('aria-label') || document.activeElement.textContent"), flush=True)
    mobile.get_by_role("button", name="More", exact=True).click()
    page.get_by_role("dialog", name="Your workspace").get_by_role("button", name="Settings", exact=True).click()
    print("FOCUS after navigation:", page.evaluate("document.activeElement.getAttribute('class')"), flush=True)
    page.set_viewport_size({"width": 1440, "height": 1000})
    sections.get_by_role("button", name="Connections", exact=True).click()
    page.get_by_role("button", name="Test connection", exact=True).click()
    expect(page.get_by_text("Connection verified.", exact=False)).to_be_visible()
    context.storage_state(path=str(out / "browser-state.json"))
    assert page.evaluate("!!localStorage.getItem('orderledger_token')")
    page.get_by_label("Backend API address", exact=True).fill("http://127.0.0.1:5999")
    page.get_by_role("button", name="Save & sign out", exact=True).click()
    expect(page.get_by_role("heading", name="Welcome back.")).to_be_visible()
    assert page.evaluate("localStorage.getItem('orderledger_token')") is None
    print("PASS Backend connection tests and changing endpoint clears authentication", flush=True)
    context.close()
    browser.close()
