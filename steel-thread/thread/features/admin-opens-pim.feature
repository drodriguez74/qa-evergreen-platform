Feature: Admin logs in and opens the PIM module

  Scenario: Admin navigates to the PIM module after logging in
    Given the admin user is on the login page
    When the admin signs in with valid credentials
    Then the Dashboard should be visible
    When the admin clicks on the PIM link
    Then the Employee Information page should be visible
