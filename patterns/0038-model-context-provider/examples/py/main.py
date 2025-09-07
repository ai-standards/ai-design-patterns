class UserPreferences:
    def __init__(self) -> None:
        # Initialize an empty list to store user preferences
        self.preferences: list[str] = []

    def update_preferences(self, new_preference: str) -> None:
        # Update user preferences and notify other context blocks
        self.preferences.append(new_preference)
        ContextProvider.notify_browsing_behavior(new_preference)

    def get_preferences(self) -> list[str]:
        # Return the list of user preferences
        return self.preferences


class BrowsingBehavior:
    def __init__(self) -> None:
        # Initialize an empty list to store visited pages
        self.visited_pages: list[str] = []

    def add_page_visit(self, page: str) -> None:
        # Add a page visit and notify recommendations
        self.visited_pages.append(page)
        ContextProvider.notify_recommendations(self.visited_pages)

    def get_visited_pages(self) -> list[str]:
        # Return the list of visited pages
        return self.visited_pages


class ContextProvider:
    user_preferences = UserPreferences()
    browsing_behavior = BrowsingBehavior()

    @staticmethod
    def notify_browsing_behavior(preference: str) -> None:
        # Notify browsing behavior of a new preference
        print(f"New preference added: {preference}")

    @staticmethod
    def notify_recommendations(visited_pages: list[str]) -> None:
        # Notify recommendations based on browsing behavior
        print(f"Updated visited pages: {', '.join(visited_pages)}")
        # Here, we could add logic to generate recommendations based on visited pages
        # For simplicity, we just log the pages to the console

    @staticmethod
    def simulate_user_actions() -> None:
        # Simulate user actions
        print("Simulating user actions...")
        ContextProvider.user_preferences.update_preferences("Electronics")
        ContextProvider.browsing_behavior.add_page_visit("Smartphone Page")
        ContextProvider.browsing_behavior.add_page_visit("Laptop Page")


def main() -> None:
    # Simulate user actions to see how context blocks interact
    ContextProvider.simulate_user_actions()


if __name__ == "__main__":
    main()
