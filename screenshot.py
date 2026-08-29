from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.set_viewport_size({"width": 1280, "height": 1024})
    page.goto('http://localhost:3000')
    page.screenshot(path='screenshot_py.png', full_page=True)
    browser.close()
    print('Screenshot saved to screenshot_py.png')
