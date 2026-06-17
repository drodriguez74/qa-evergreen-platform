Feature: Admin logs in and reaches the dashboard

  Scenario: Admin logs in and reaches the dashboard
    Given the admin is on the OrangeHRM login page
    When the admin signs in with username "Admin" and password "admin123"
    Then the dashboard heading should be visible
