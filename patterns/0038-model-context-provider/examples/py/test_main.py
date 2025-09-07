import pytest
from unittest.mock import patch
from main import UserPreferences, BrowsingBehavior, ContextProvider

class TestUserPreferences:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.user_preferences = UserPreferences()

    def test_update_preferences_correctly(self):
        self.user_preferences.update_preferences('Books')
        assert self.user_preferences.get_preferences() == ['Books']

    def test_allow_multiple_preferences_to_be_added(self):
        self.user_preferences.update_preferences('Books')
        self.user_preferences.update_preferences('Electronics')
        assert self.user_preferences.get_preferences() == ['Books', 'Electronics']

    def test_not_break_when_adding_undefined_preference(self):
        self.user_preferences.update_preferences(None)  # Simulating an edge case
        assert self.user_preferences.get_preferences() == [None]

class TestBrowsingBehavior:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.browsing_behavior = BrowsingBehavior()

    def test_add_page_visits_correctly(self):
        self.browsing_behavior.add_page_visit('Homepage')
        assert self.browsing_behavior.get_visited_pages() == ['Homepage']

    def test_allow_multiple_page_visits_to_be_added(self):
        self.browsing_behavior.add_page_visit('Homepage')
        self.browsing_behavior.add_page_visit('Contact Page')
        assert self.browsing_behavior.get_visited_pages() == ['Homepage', 'Contact Page']

    def test_not_break_when_adding_undefined_page_visit(self):
        self.browsing_behavior.add_page_visit(None)  # Simulating an edge case
        assert self.browsing_behavior.get_visited_pages() == [None]

class TestContextProvider:
    @patch('builtins.print')
    def test_simulate_user_actions_correctly(self, mock_print):
        ContextProvider.simulate_user_actions()

        mock_print.assert_any_call('Simulating user actions...')
        mock_print.assert_any_call('New preference added: Electronics')
        mock_print.assert_any_call('Updated visited pages: Smartphone Page, Laptop Page')
