Feature: Admin logs in and reaches the dashboard

  Scenario: Admin logs in and reaches the dashboard
    Given I am on the OrangeHRM login page
    When I sign in as Admin with password "admin123"
    Then I should see the Dashboard
