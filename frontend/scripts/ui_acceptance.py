"""Browser acceptance for a disposable, local OrderLedger instance.

Start backend with npm run dev:isolated, and frontend with VITE_API_URL pointing
at it. Run: py -3 scripts/ui_acceptance.py --base-url http://127.0.0.1:5174
Requires Python Playwright and Chromium. Never run against customer data.
Artifacts and synthetic credentials stay in the OS temporary directory.
"""
import argparse
import json
import secrets
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:5174")
parser.add_argument("--api-url", default="http://127.0.0.1:5100")
parser.add_argument("--stage", choices=["all", "setup", "workflow", "responsive"], default="all")
args = parser.parse_args()
for address in [args.base_url, args.api_url]:
    if urlparse(address).hostname not in ["127.0.0.1", "localhost"]:
        raise SystemExit("Acceptance tests only support disposable loopback servers.")
out = Path(tempfile.gettempdir()) / "orderledger-ui-qa"
out.mkdir(exist_ok=True)
state = out / "browser-state.json"
checks = []
errors = []


def passed(name):
    checks.append(name)
    print("PASS " + name, flush=True)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context_options = {"viewport": {"width": 1440, "height": 1000}, "accept_downloads": True}
    if args.stage in ["workflow", "responsive"] and state.exists():
        context_options["storage_state"] = str(state)
    context = browser.new_context(**context_options)
    context.set_default_timeout(25000)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))

    def screenshot(name):
        page.screenshot(path=str(out / (name + ".png")), full_page=True)

    def nav(label):
        page.get_by_role("navigation", name="Main navigation", exact=True).get_by_role("button", name=label, exact=True).click()

    def section(label):
        page.get_by_role("navigation", name="Settings sections").get_by_role("button", name=label, exact=True).click()

    def save_settings():
        page.get_by_role("button", name="Save changes", exact=True).click()
        expect(page.get_by_text("All changes saved.", exact=True)).to_be_visible(timeout=30000)

    def no_overflow():
        assert page.evaluate("document.body.scrollWidth <= innerWidth + 1"), "Horizontal page overflow"

    try:
        page.goto(args.base_url, wait_until="domcontentloaded", timeout=90000)
        try:
            page.wait_for_load_state("networkidle", timeout=30000)
        except Exception:
            page.locator("#root > *").first.wait_for(timeout=60000)

        if args.stage in ["all", "setup"]:
            expect(page.get_by_role("heading", name="Welcome back.")).to_be_visible()
            page.get_by_role("button", name="Create a business", exact=True).click()
            stamp = str(int(time.time()))
            password = "QA-" + secrets.token_hex(8)
            email = "qa-" + stamp + "@example.test"
            page.get_by_label("Business name", exact=True).fill("Cedar Market")
            page.get_by_label("Workspace ID", exact=True).fill("cedar-" + stamp)
            page.get_by_label("Your name", exact=True).fill("Arman")
            page.get_by_label("Business phone", exact=True).fill("9876543210")
            page.get_by_label("Email address", exact=True).fill(email)
            page.get_by_label("Password", exact=True).fill(password)
            page.get_by_role("button", name="Create business", exact=True).click()
            expect(page.get_by_role("heading", name="A little setup goes a long way")).to_be_visible(timeout=45000)
            context.storage_state(path=str(state))
            (out / "synthetic-account.json").write_text(json.dumps({"email": email, "password": password}), encoding="utf8")
            screenshot("dashboard-empty")
            passed("Register a business and show first-run setup")

            nav("Settings")
            section("Blueprints")
            page.get_by_role("button", name="Fresh produce", exact=False).click()
            page.get_by_role("dialog").get_by_role("button", name="Apply to settings", exact=True).click()
            section("Appearance")
            page.get_by_label("App name", exact=True).fill("Cedar Ledger")
            page.get_by_label("Tagline", exact=True).fill("Fresh stock. Clear accounts.")
            page.get_by_role("button", name="Sage", exact=True).click()
            page.get_by_label("Default theme", exact=True).select_option("light")
            section("Catalog & labels")
            page.get_by_label("Available units", exact=True).fill("kg, gram, box, piece, dozen")
            page.get_by_label("Catalog categories", exact=True).fill("Vegetables, Fruits, Herbs")
            section("Billing & payments")
            page.get_by_label("Invoice prefix", exact=True).fill("CM")
            page.get_by_label("Tax rate (%)", exact=True).fill("5")
            page.get_by_label("Default payment terms (days)", exact=True).fill("14")
            page.get_by_label("Invoice footer", exact=True).fill("Thank you for shopping with Cedar Market.")
            save_settings()
            page.reload(wait_until="domcontentloaded")
            expect(page.get_by_role("button", name="Cedar Ledger", exact=False)).to_be_visible(timeout=30000)
            nav("Settings")
            section("Billing & payments")
            expect(page.get_by_label("Invoice prefix", exact=True)).to_have_value("CM")
            expect(page.get_by_label("Tax rate (%)", exact=True)).to_have_value("5")
            passed("Save preset, branding and billing; persist after reload")

            section("Blueprints")
            with page.expect_download() as download_info:
                page.get_by_role("button", name="Export blueprint", exact=True).click()
            blueprint_path = out / "blueprint.json"
            download_info.value.save_as(str(blueprint_path))
            blueprint = json.loads(blueprint_path.read_text(encoding="utf8"))
            assert blueprint["settings"]["billing"]["invoicePrefix"] == "CM"
            assert "profile" not in blueprint["settings"]
            serialized = json.dumps(blueprint).lower()
            assert "apikey" not in serialized and "customer_id" not in serialized and "password" not in serialized
            page.get_by_label("Import a blueprint", exact=True).set_input_files(str(blueprint_path))
            expect(page.get_by_role("dialog", name="Preview blueprint")).to_be_visible()
            page.get_by_role("dialog", name="Preview blueprint").get_by_role("button", name="Cancel", exact=True).click()
            passed("Blueprint export excludes secrets/data and import previews")

            section("Connections")
            page.get_by_label("Primary model", exact=True).fill("future-model")
            page.get_by_label("Primary API key", exact=True).fill("synthetic-qa-key")
            page.get_by_role("button", name="Save provider connections", exact=True).click()
            expect(page.get_by_text("Connections saved.", exact=False)).to_be_visible()
            expect(page.get_by_label("Primary API key", exact=True)).to_have_value("")
            page.reload(wait_until="domcontentloaded")
            expect(page.get_by_role("navigation", name="Main navigation", exact=True)).to_be_visible()
            nav("Settings")
            section("Connections")
            expect(page.get_by_label("Primary model", exact=True)).to_have_value("future-model")
            expect(page.get_by_label("Primary API key", exact=True)).to_have_value("")
            assert page.get_by_text("Key saved", exact=True).count() >= 1
            passed("Provider settings persist while saved key remains hidden")

            nav("Catalog")
            page.get_by_role("button", name="Add product", exact=True).click()
            dialog = page.get_by_role("dialog", name="Add a product")
            dialog.get_by_label("Product name", exact=True).fill("Fresh tomatoes")
            dialog.get_by_label("Price per unit", exact=True).fill("40.50")
            dialog.get_by_label("Category", exact=True).fill("Vegetables")
            expect(dialog.get_by_label("Unit", exact=True)).to_have_value("kg")
            dialog.get_by_role("button", name="Save product", exact=True).click()
            expect(dialog).not_to_be_visible()
            expect(page.get_by_text("Fresh tomatoes", exact=True)).to_be_visible()
            page.get_by_role("button", name="Edit Fresh tomatoes", exact=True).click()
            dialog = page.get_by_role("dialog", name="Edit product")
            dialog.get_by_label("Price per unit", exact=True).fill("45.25")
            dialog.get_by_role("button", name="Save product", exact=True).click()
            expect(dialog).not_to_be_visible()
            expect(page.get_by_text("₹45.25", exact=True)).to_be_visible()
            page.get_by_role("button", name="Archive Fresh tomatoes", exact=True).click()
            page.get_by_role("dialog", name="Archive product?").get_by_role("button", name="Archive product", exact=True).click()
            expect(page.get_by_role("dialog", name="Archive product?")).not_to_be_visible()
            page.get_by_role("button", name="Archived", exact=False).click()
            page.get_by_role("button", name="Restore", exact=True).click()
            page.get_by_role("button", name="Active", exact=False).click()
            expect(page.get_by_text("Fresh tomatoes", exact=True)).to_be_visible()
            passed("Create, edit, archive and restore a catalog product")

            page.get_by_role("button", name="Add product", exact=True).click()
            dialog = page.get_by_role("dialog", name="Add a product")
            dialog.get_by_label("Product name", exact=True).fill("Fresh tomatoes")
            dialog.get_by_label("Price per unit", exact=True).fill("20")
            dialog.get_by_role("button", name="Save product", exact=True).click()
            expect(dialog.get_by_role("alert")).to_be_visible()
            expect(dialog.get_by_label("Product name", exact=True)).to_have_value("Fresh tomatoes")
            dialog.get_by_role("button", name="Cancel", exact=True).click()
            passed("Duplicate save keeps form data and displays inline error")
            screenshot("catalog-desktop")

            nav("Customers")
            page.get_by_role("button", name="Add customer", exact=True).click()
            dialog = page.get_by_role("dialog", name="Add a customer")
            dialog.get_by_label("Customer name", exact=True).fill("Maple Café")
            dialog.get_by_label("Phone number", exact=True).fill("9123456789")
            expect(dialog.get_by_label("Payment terms (days)", exact=True)).to_have_value("14")
            dialog.get_by_label("Payment terms (days)", exact=True).fill("0")
            dialog.get_by_role("button", name="Save customer", exact=True).click()
            expect(dialog).not_to_be_visible()
            page.get_by_role("button", name="Edit Maple Café", exact=True).click()
            dialog = page.get_by_role("dialog", name="Edit customer")
            expect(dialog.get_by_label("Payment terms (days)", exact=True)).to_have_value("0")
            dialog.get_by_label("Payment terms (days)", exact=True).fill("7")
            dialog.get_by_role("button", name="Save customer", exact=True).click()
            expect(dialog).not_to_be_visible()
            passed("Customer create/edit and zero-day terms")
            context.storage_state(path=str(state))

        if args.stage in ["all", "workflow"]:
            page.get_by_role("banner").get_by_role("button", name="New order", exact=True).click()
            dialog = page.get_by_role("dialog", name="Create an order")
            dialog.get_by_label("Quantity 1", exact=True).fill("2")
            expect(dialog.get_by_text("₹95.03", exact=True)).to_be_visible()
            dialog.get_by_label("Order notes", exact=True).fill("Deliver before noon.")
            dialog.get_by_role("button", name="Create order", exact=True).click()
            expect(dialog).not_to_be_visible()
            nav("Orders")
            page.get_by_role("button", name="View order", exact=True).first.click()
            dialog = page.get_by_role("dialog", name="Order #", exact=False)
            expect(dialog.get_by_text("Fresh tomatoes", exact=True)).to_be_visible()
            dialog.get_by_role("button", name="Mark as packed", exact=True).click()
            expect(dialog.get_by_role("button", name="Mark as delivered", exact=True)).to_be_visible()
            dialog.get_by_role("button", name="Mark as delivered", exact=True).click()
            expect(dialog.get_by_role("button", name="Open CM-", exact=False)).to_be_visible()
            dialog.get_by_role("button", name="Open CM-", exact=False).click()
            dialog = page.get_by_role("dialog", name="CM-", exact=False)
            expect(dialog.get_by_text("Fresh tomatoes", exact=True)).to_be_visible()
            expect(dialog.get_by_role("button", name="Print / Save PDF", exact=True)).to_be_visible()
            page.emulate_media(media="print")
            page.pdf(path=str(out / "invoice.pdf"), format="A4", print_background=True)
            page.emulate_media(media="screen")
            screenshot("invoice-desktop")
            passed("Create order, advance status, invoice tax and print output")

            dialog.get_by_role("button", name="Record payment", exact=True).click()
            dialog = page.get_by_role("dialog", name="Record a payment")
            dialog.get_by_label("Amount received", exact=True).fill("95.03")
            dialog.get_by_label("Reference number", exact=True).fill("CASH-QA")
            dialog.get_by_role("button", name="Save payment", exact=True).click()
            expect(dialog).not_to_be_visible()
            nav("Invoices")
            expect(page.get_by_text("₹0.00 remaining", exact=True).first).to_be_visible()
            nav("Payments")
            expect(page.get_by_text("₹95.03", exact=True).first).to_be_visible()
            passed("Record payment and reconcile invoice balance")

            nav("Customers")
            page.get_by_role("button", name="Statement", exact=True).first.click()
            dialog = page.get_by_role("dialog", name="Customer statement")
            expect(dialog.get_by_text("CASH-QA", exact=True)).to_be_visible()
            with page.expect_download(timeout=60000) as info:
                dialog.get_by_role("button", name="Download PDF", exact=True).click()
            pdf_path = out / "statement.pdf"
            info.value.save_as(str(pdf_path))
            assert pdf_path.read_bytes().startswith(b"%PDF")
            assert pdf_path.stat().st_size > 1000
            dialog.get_by_label("Statement from", exact=True).fill("2020-01-01")
            dialog.get_by_role("button", name="Apply", exact=True).click()
            expect(dialog.get_by_text("CASH-QA", exact=True)).to_be_visible()
            dialog.get_by_role("button", name="Clear", exact=True).click()
            expect(dialog.get_by_label("Statement from", exact=True)).to_have_value("")
            dialog.get_by_role("button", name="Close dialog", exact=True).click()
            passed("Customer statement, date filters and actual PDF download")

            nav("Reports")
            expect(page.get_by_role("heading", name="How long has it been due?", exact=True)).to_be_visible()
            page.get_by_role("button", name="Sales", exact=True).click()
            expect(page.get_by_text("Total sales", exact=True)).to_be_visible()
            expect(page.get_by_role("alert")).to_have_count(0)
            page.get_by_role("button", name="Collections", exact=True).click()
            expect(page.get_by_text("How customers paid", exact=True)).to_be_visible()
            passed("Reports render real sales and collections")

            nav("Settings")
            section("Features")
            page.get_by_role("switch", name="Business reports", exact=True).click()
            save_settings()
            expect(page.get_by_role("navigation", name="Main navigation", exact=True).get_by_role("button", name="Reports", exact=True)).to_have_count(0)
            page.get_by_role("switch", name="Business reports", exact=True).click()
            save_settings()
            expect(page.get_by_role("navigation", name="Main navigation", exact=True).get_by_role("button", name="Reports", exact=True)).to_be_visible()
            section("Appearance")
            page.get_by_label("Tagline", exact=True).fill("Unsaved text")
            nav("Catalog")
            dialog = page.get_by_role("dialog", name="Unsaved settings", exact=True)
            expect(dialog).to_be_visible()
            dialog.get_by_role("button", name="Keep editing", exact=True).click()
            expect(page.get_by_label("Tagline", exact=True)).to_have_value("Unsaved text")
            page.get_by_role("button", name="Discard", exact=True).click()
            passed("Feature switch takes effect and unsaved settings are protected")
            context.storage_state(path=str(state))

        if args.stage in ["all", "responsive"]:
            nav("Overview")
            expect(page.get_by_text("Total outstanding", exact=True)).to_be_visible()
            screenshot("dashboard-desktop")
            no_overflow()
            nav("Settings")
            section("Appearance")
            page.get_by_role("button", name="Lavender", exact=True).click()
            page.get_by_label("Default theme", exact=True).select_option("dark")
            save_settings()
            assert page.locator("html").get_attribute("data-theme") == "dark"
            assert page.locator("html").get_attribute("data-accent") == "lavender"
            screenshot("settings-dark")
            nav("Overview")
            screenshot("dashboard-dark")
            page.set_viewport_size({"width": 390, "height": 844})
            no_overflow()
            screenshot("dashboard-mobile-dark")
            mobile = page.get_by_role("navigation", name="Mobile navigation", exact=True)
            mobile.get_by_role("button", name="More", exact=True).click()
            menu = page.get_by_role("dialog", name="Your workspace", exact=True)
            for label in ["Invoices", "Payments", "Reports", "Settings"]:
                expect(menu.get_by_role("button", name=label, exact=True)).to_be_visible()
            page.keyboard.press("Tab")
            assert page.evaluate("!!document.activeElement.closest('dialog')")
            page.keyboard.press("Escape")
            expect(menu).not_to_be_visible()
            passed("Mobile navigation exposes every module; dialog focus and Escape work")
            mobile.get_by_role("button", name="Catalog", exact=True).click()
            no_overflow()
            screenshot("catalog-mobile-dark")
            mobile.get_by_role("button", name="More", exact=True).click()
            page.get_by_role("dialog", name="Your workspace", exact=True).get_by_role("button", name="Settings", exact=True).click()
            section("Appearance")
            page.get_by_role("button", name="Sage", exact=True).click()
            page.get_by_label("Default theme", exact=True).select_option("light")
            save_settings()
            page.emulate_media(reduced_motion="reduce")
            no_overflow()
            screenshot("settings-mobile-light")
            page.set_viewport_size({"width": 740, "height": 390})
            no_overflow()
            page.set_viewport_size({"width": 1440, "height": 1000})
            nav("Overview")
            screenshot("dashboard-final")
            passed("Light/dark palettes and responsive portrait/landscape without overflow")

        assert not errors, "Browser exceptions: " + " | ".join(errors)
        passed("No uncaught browser exceptions")
        context.storage_state(path=str(state))
        (out / ("results-" + args.stage + ".json")).write_text(json.dumps({"checks": checks, "errors": errors, "artifacts": str(out)}, indent=2), encoding="utf8")
        print("COMPLETE: " + str(len(checks)) + " acceptance checks. Artifacts: " + str(out), flush=True)
    except Exception:
        screenshot("failure-" + args.stage)
        (out / "failure-page.txt").write_text(page.locator("body").inner_text(), encoding="utf8")
        raise
    finally:
        context.close()
        browser.close()
