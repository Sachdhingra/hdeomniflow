# Add Insider Data to the Daily Backup

## What will change
- Keep the existing 8 PM email, filename, recipients, and five current worksheets unchanged.
- Add one worksheet named **Insider Data** to the same Excel attachment.
- Include every Insider app account created since launch, including inactive records, with customer/card details, app activation details, current and lifetime point balances, and the complete points transaction history.
- Repeat customer/card details on each points-history row so the sheet remains filterable; customers without a points transaction will still have one row.

## Verification
- Confirm the new sheet contains all app accounts and all related point entries without truncation.
- Generate a test workbook, verify the six worksheet names and record totals, and check it contains no spreadsheet errors.
- Deploy the updated evening-report function without changing its schedule.

## Technical details
- Read `app_users` as the authoritative “apps created” list, join it to `elite_customers`, and attach `card_points` entries by customer ID.
- Use paginated database reads so future growth beyond 1,000 records is fully included.
- Preserve the existing report logic and append the new worksheet before workbook serialization.
