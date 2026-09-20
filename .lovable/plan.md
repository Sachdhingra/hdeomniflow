# Daily tailored WhatsApp follow-ups

## Goal
Use the newly approved YES/NO WhatsApp message for daily, product-relevant follow-ups that encourage a clear response and route interest to the assigned salesperson.

## Changes
- Activate the approved YES/NO template and keep the older approved message only as a safe fallback.
- Personalize the product phrase from each lead’s product, stated need, or category; use concise Interio-inspired benefits for broad categories without copying prices or unverified stock claims.
- Keep the existing 24-hour duplicate protection and skip customers who replied NO until reviewed.
- Keep the two daily checks at 6:00 PM and 8:00 PM India time; each customer receives at most one matching follow-up in 24 hours.
- Show the approved status and actual schedule in the automation monitor.

## Verification
- Test named products and category-only leads, including sofa, sofa-cum-bed, wardrobe, bed, mattress, dining, kitchen, and office furniture.
- Verify the approved template is used, customer/product variables are filled, and the second daily check cannot duplicate a send.
- Deploy the follow-up engine and confirm recent runs remain healthy.

## Technical details
- Reuse the existing WhatsApp delivery, reply logging, YES/NO intent handling, salesperson alerts, and Kanban priority flow.
- Product wording is deterministic from lead data; the daily job will not scrape live prices or availability, preventing inaccurate customer promises.
