import asyncio
from playwright.async_api import async_playwright

async def run_e2e():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        # Log all console messages
        page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
        
        print("1. Navigating to /app...")
        await page.goto("http://localhost:3000/app")
        
        print("Waiting for hydration...")
        # Wait for the button to be interactive
        btn = page.locator("button", has_text="Launch Autonomous Heal")
        await btn.wait_for(state="visible", timeout=10000)
        await page.wait_for_timeout(2000) # give extra time for react hydration
        
        # Take initial screenshot
        await page.screenshot(path="e2e_1_initial.png", full_page=True)
        print("-> Saved e2e_1_initial.png")
        
        print("2. Clicking 'Launch Autonomous Heal'...")
        await btn.click()
        
        print("3. Waiting for Swarm execution (Diagnostic -> Patch -> Verify)...")
        # Ensure the button changed to loading state
        await page.locator("button", has_text="Swarm In Flight").wait_for(state="visible", timeout=5000)
        
        # Wait up to 60 seconds for the approval card to appear
        approve_button = page.get_by_role("button", name="Approve & Open GitHub PR")
        await approve_button.wait_for(state="visible", timeout=60000)
        
        await page.wait_for_timeout(1000)
        await page.screenshot(path="e2e_2_approval_gate.png", full_page=True)
        print("-> Saved e2e_2_approval_gate.png")
        
        print("4. Clicking 'Approve & Open GitHub PR'...")
        await approve_button.click()
        
        print("5. Waiting for GitHub PR creation...")
        # Wait for the status badge to say "HEALED & PR PUBLISHED"
        await page.get_by_text("HEALED & PR PUBLISHED").wait_for(state="visible", timeout=30000)
        
        await page.wait_for_timeout(1000)
        await page.screenshot(path="e2e_3_completed.png", full_page=True)
        print("-> Saved e2e_3_completed.png")
        
        print("✅ E2E Test Completed Successfully!")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_e2e())
