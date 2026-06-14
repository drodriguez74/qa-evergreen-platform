Feature: Analyst initiates and confirms a transfer (happy path)

  Background:
    Given the analyst navigates to the login page

  Scenario: Analyst logs in, fills transfer details, and receives a receipt
    # Step 1 – Sign in
    Given the analyst is on the Sign in page
    When they fill in "Username" with "analyst"
    And they fill in "Password" with "demo1234"
    And they click "Sign in"

    # Step 2 – Dashboard
    Then the "Dashboard" heading is visible
    When they click "Initiate Transfer"

    # Step 3 – Transfer form
    Then the "Initiate Transfer" heading is visible
    When they select "Operating" from "From account"
    And they select "Acme Supplies" from "Payee"
    And they fill in "Amount" with "2500"
    And they fill in "Memo" with "Q2 invoice"
    And they click "Continue to review"

    # Step 4 – Review
    Then the "Review & Confirm" heading is visible
    And the text "Amount: $2,500.00" is visible
    When they click "Confirm transfer"

    # Step 5 – Receipt (state-change assertions — mandatory)
    Then the "Transfer Complete" heading is visible
    And a Transaction ID matching "Transaction ID: <non-empty value>" is displayed
    And the "Back to dashboard" button is visible
